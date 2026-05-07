# Feature: cardflow-platform, Property 24: Move application preserves board invariants

import uuid

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from hypothesis import given, settings, assume
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork, GamePiece, GameSession
from app.schemas import (
    BoardPieceState,
    GameModeEnum,
    MoveRequest,
    OwnerEnum,
    SessionResponse,
)
from app.services import session_manager
from app.services.minimax import _compute_valid_moves_pure

# ---------------------------------------------------------------------------
# Test app
# ---------------------------------------------------------------------------

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(test_engine)

test_app = FastAPI()


def get_db():
    with Session(test_engine) as session:
        yield session


def _to_response(gs) -> SessionResponse:
    return SessionResponse(
        session_id=gs.id,
        game_mode=GameModeEnum(gs.game_mode),
        current_turn=OwnerEnum(gs.current_turn),
        winner=gs.winner,
        board_state=[BoardPieceState(**p) for p in gs.board_state],
    )


@test_app.post("/game/{session_id}/move", response_model=SessionResponse)
def apply_move(session_id: uuid.UUID, body: MoveRequest, db: Session = Depends(get_db)):
    gs = session_manager.apply_move(session_id, body, db)
    return _to_response(gs)


client = TestClient(test_app)


def _make_db_piece(db: Session, element: str = "Neutral") -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(artwork_id=artwork.id, name="P", element=element, base_hp=100, base_atk=1)
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


def _create_session_with_board(board: list[BoardPieceState], piece_id_map: dict) -> uuid.UUID:
    """Persist a GameSession with real DB piece IDs in board_state."""
    with Session(test_engine) as db:
        gs = GameSession(
            game_mode="pvp",
            current_turn="player",
            winner=None,
            board_state=[p.model_dump(mode="json") for p in board],
            ai_depth=3,
        )
        db.add(gs)
        db.commit()
        db.refresh(gs)
        return gs.id


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

@st.composite
def non_attack_move_strategy(draw):
    """
    Generate a board where the player piece has at least one non-attack move
    (empty destination square).
    """
    # Place player piece in rows 2-6 so it has room to move forward (toward row 0)
    player_row = draw(st.integers(2, 6))
    player_col = draw(st.integers(0, 7))
    is_evolved = draw(st.booleans())

    player_id = uuid.uuid4()
    opponent_id = uuid.uuid4()

    # Place opponent far away to avoid blocking
    opp_row = draw(st.integers(0, 1))
    opp_col = draw(st.integers(0, 7))

    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=[player_row, player_col],
            current_hp=100,
            is_evolved=is_evolved,
        ),
        BoardPieceState(
            piece_id=opponent_id,
            owner=OwnerEnum.opponent,
            position=[opp_row, opp_col],
            current_hp=100,
            is_evolved=False,
        ),
    ]

    piece_state = board[0]
    valid = _compute_valid_moves_pure(piece_state, board)
    # Filter to non-attack (empty) moves only
    occupied = {tuple(p.position) for p in board}
    empty_moves = [m for m in valid if tuple(m) not in occupied]

    assume(len(empty_moves) > 0)
    dest = draw(st.sampled_from(empty_moves))
    return board, player_id, dest


# ---------------------------------------------------------------------------
# Property 24
# ---------------------------------------------------------------------------

@given(scenario=non_attack_move_strategy())
@settings(max_examples=20, deadline=None)
def test_move_preserves_board_invariants(scenario):
    """
    **Validates: Requirements 17.1, 17.5, 17.6, 17.8**

    After applying a valid non-attack move:
    1. No two pieces share the same position.
    2. The moved piece is at to_position.
    3. Total piece count is unchanged (non-attack move).
    4. current_turn has switched to the other player.
    """
    board, player_id, dest = scenario

    # Create real DB pieces so session_manager can look them up
    with Session(test_engine) as db:
        real_player_id = _make_db_piece(db)
        real_opponent_id = _make_db_piece(db)

    # Remap board to use real DB IDs
    board[0].piece_id = real_player_id
    board[1].piece_id = real_opponent_id

    session_id = _create_session_with_board(board, {})

    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(real_player_id), "to_position": dest},
    )
    assert response.status_code == 200, response.text

    data = response.json()
    new_board = data["board_state"]

    # 1. No two pieces share the same position
    positions = [tuple(p["position"]) for p in new_board]
    assert len(positions) == len(set(positions)), "Two pieces share the same position"

    # 2. Moved piece is at destination
    moved = next((p for p in new_board if p["piece_id"] == str(real_player_id)), None)
    assert moved is not None, "Moved piece not found in response"
    assert moved["position"] == dest, f"Piece at {moved['position']}, expected {dest}"

    # 3. Piece count unchanged (non-attack move)
    assert len(new_board) == len(board), (
        f"Piece count changed: {len(board)} -> {len(new_board)}"
    )

    # 4. current_turn switched to opponent
    assert data["current_turn"] == "opponent", (
        f"Expected current_turn='opponent', got '{data['current_turn']}'"
    )
