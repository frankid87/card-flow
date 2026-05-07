# Property 31: AI difficulty levels produce valid moves

import uuid

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork, GamePiece, GameSession
from app.schemas import (
    BoardPieceState,
    DifficultyEnum,
    GameModeEnum,
    OwnerEnum,
    SessionCreateRequest,
)
from app.services import session_manager
from app.services.minimax import best_move, _all_moves_for_owner

# ---------------------------------------------------------------------------
# Shared in-memory DB
# ---------------------------------------------------------------------------

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(test_engine)


def _make_piece(db: Session, element: str = "Neutral", base_hp: int = 10) -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(
        artwork_id=artwork.id,
        name="TestPiece",
        element=element,
        base_hp=base_hp,
        base_atk=5,
    )
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


def _create_pvc_session(difficulty: str) -> GameSession:
    with Session(test_engine) as db:
        p_id = _make_piece(db)
        o_id = _make_piece(db)
        req = SessionCreateRequest(
            player_piece_ids=[p_id],
            opponent_piece_ids=[o_id],
            game_mode=GameModeEnum.pvc,
            difficulty=DifficultyEnum(difficulty),
        )
        gs = session_manager.create_session(req, db)
        # Detach from session by reading values
        return gs


# ---------------------------------------------------------------------------
# Property 31a: difficulty is persisted correctly
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_difficulty_persisted(difficulty: str):
    """
    For each difficulty level, the created session must store the correct
    difficulty value and the corresponding ai_depth.
    """
    expected_depth = {"easy": 1, "medium": 3, "hard": 5}
    with Session(test_engine) as db:
        p_id = _make_piece(db)
        o_id = _make_piece(db)
        req = SessionCreateRequest(
            player_piece_ids=[p_id],
            opponent_piece_ids=[o_id],
            game_mode=GameModeEnum.pvc,
            difficulty=DifficultyEnum(difficulty),
        )
        gs = session_manager.create_session(req, db)
        assert gs.difficulty == difficulty, f"Expected difficulty={difficulty}, got {gs.difficulty}"
        assert gs.ai_depth == expected_depth[difficulty], (
            f"Expected ai_depth={expected_depth[difficulty]}, got {gs.ai_depth}"
        )


# ---------------------------------------------------------------------------
# Property 31b: default difficulty (no difficulty provided) keeps ai_depth=3
# ---------------------------------------------------------------------------

def test_no_difficulty_uses_default_depth():
    """When difficulty is not provided, ai_depth defaults to 3 and difficulty is None."""
    with Session(test_engine) as db:
        p_id = _make_piece(db)
        o_id = _make_piece(db)
        req = SessionCreateRequest(
            player_piece_ids=[p_id],
            opponent_piece_ids=[o_id],
            game_mode=GameModeEnum.pvc,
        )
        gs = session_manager.create_session(req, db)
        assert gs.difficulty is None
        assert gs.ai_depth == 3


# ---------------------------------------------------------------------------
# Property 31c: best_move always returns a valid move (or None when no moves)
# ---------------------------------------------------------------------------

@given(
    n_player=st.integers(min_value=1, max_value=3),
    n_opponent=st.integers(min_value=1, max_value=3),
    difficulty=st.sampled_from(["easy", "medium", "hard"]),
)
@settings(max_examples=20, deadline=None)
def test_ai_move_is_valid(n_player: int, n_opponent: int, difficulty: str):
    """
    For any board configuration and any difficulty level, best_move must either
    return None (no moves available) or return a MoveRequest whose piece_id
    belongs to the opponent and whose to_position is in the list of valid moves
    for that piece.
    """
    depth_map = {"easy": 1, "medium": 3, "hard": 5}
    with Session(test_engine) as db:
        player_ids = [_make_piece(db) for _ in range(n_player)]
        opponent_ids = [_make_piece(db) for _ in range(n_opponent)]
        req = SessionCreateRequest(
            player_piece_ids=player_ids,
            opponent_piece_ids=opponent_ids,
            game_mode=GameModeEnum.pvc,
            difficulty=DifficultyEnum(difficulty),
        )
        gs = session_manager.create_session(req, db)

        board = [BoardPieceState(**p) for p in gs.board_state]
        all_valid = _all_moves_for_owner(board, OwnerEnum.opponent)

        # Build piece_elements map
        from app.services.session_manager import _build_piece_elements
        piece_elements = _build_piece_elements(board, db)

        move = best_move(gs, depth_map[difficulty], piece_elements)

        if all_valid:
            assert move is not None, "Expected a move but got None"
            # The returned move must be among the valid moves
            assert (move.piece_id, move.to_position) in all_valid, (
                f"Move ({move.piece_id}, {move.to_position}) not in valid moves"
            )
        else:
            assert move is None, "Expected None when no moves available"
