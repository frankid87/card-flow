# Feature: cardflow-platform, Property 23: Valid moves consistency — server matches checkers rules

import uuid

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from hypothesis import given, settings
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
    ValidMovesResponse,
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


@test_app.get("/game/{session_id}/valid-moves/{piece_id}", response_model=ValidMovesResponse)
def get_valid_moves(session_id: uuid.UUID, piece_id: uuid.UUID, db: Session = Depends(get_db)):
    moves = session_manager.get_valid_moves(session_id, piece_id, db)
    return ValidMovesResponse(piece_id=piece_id, moves=moves)


client = TestClient(test_app)


def _make_piece(db: Session) -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(artwork_id=artwork.id, name="P", element="Neutral", base_hp=10, base_atk=5)
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


def _create_session_with_board(board: list[BoardPieceState]) -> uuid.UUID:
    """Persist a GameSession directly with the given board state."""
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
def board_with_piece_strategy(draw):
    """Generate a board with 1 player piece and 1 opponent piece at distinct positions."""
    positions = draw(
        st.lists(
            st.tuples(st.integers(1, 6), st.integers(0, 7)),
            min_size=2,
            max_size=2,
            unique=True,
        )
    )
    is_evolved = draw(st.booleans())
    player_id = uuid.uuid4()
    opponent_id = uuid.uuid4()
    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=list(positions[0]),
            current_hp=10,
            is_evolved=is_evolved,
        ),
        BoardPieceState(
            piece_id=opponent_id,
            owner=OwnerEnum.opponent,
            position=list(positions[1]),
            current_hp=10,
            is_evolved=False,
        ),
    ]
    return board, player_id


# ---------------------------------------------------------------------------
# Property 23
# ---------------------------------------------------------------------------

@given(board_and_piece=board_with_piece_strategy())
@settings(max_examples=20, deadline=None)
def test_valid_moves_consistency(board_and_piece):
    """
    **Validates: Requirements 18.1, 18.4**

    For any board state, GET /game/{id}/valid-moves/{pid} must return exactly
    the set of legal diagonal destinations computed by the checkers movement
    rules (forward for normal, forward+backward for evolved, jump when
    opponent is in path and landing is empty).
    """
    board, player_id = board_and_piece
    session_id = _create_session_with_board(board)

    response = client.get(f"/game/{session_id}/valid-moves/{player_id}")
    assert response.status_code == 200, response.text

    data = response.json()
    server_moves = sorted(data["moves"])

    # Compute expected moves using the pure helper (same logic as session_manager)
    piece_state = next(p for p in board if p.piece_id == player_id)
    expected_moves = sorted(_compute_valid_moves_pure(piece_state, board))

    assert server_moves == expected_moves, (
        f"Server moves {server_moves} != expected {expected_moves} "
        f"for piece at {piece_state.position} (evolved={piece_state.is_evolved})"
    )
