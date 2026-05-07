# Feature: cardflow-platform, Property 27: Invalid move rejected with 400

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


def _make_db_piece(db: Session) -> uuid.UUID:
    artwork = Artwork(image_url="http://example.com/img.png")
    db.add(artwork)
    db.commit()
    db.refresh(artwork)
    piece = GamePiece(artwork_id=artwork.id, name="P", element="Neutral", base_hp=50, base_atk=5)
    db.add(piece)
    db.commit()
    db.refresh(piece)
    return piece.id


# ---------------------------------------------------------------------------
# Property 27
# ---------------------------------------------------------------------------

@given(
    player_row=st.integers(2, 5),
    player_col=st.integers(0, 7),
    bad_row=st.integers(0, 7),
    bad_col=st.integers(0, 7),
)
@settings(max_examples=20, deadline=None)
def test_invalid_move_rejected_with_400(player_row, player_col, bad_row, bad_col):
    """
    **Validates: Requirements 17.4**

    Any move where to_position is not in the valid moves list must return HTTP 400.
    """
    with Session(test_engine) as db:
        player_id = _make_db_piece(db)
        opp_id = _make_db_piece(db)

    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=[player_row, player_col],
            current_hp=50,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_id,
            owner=OwnerEnum.opponent,
            position=[0, 0] if (player_row > 1 or player_col > 0) else [7, 7],
            current_hp=50,
            is_evolved=False,
        ),
    ]

    piece_state = board[0]
    valid_moves = _compute_valid_moves_pure(piece_state, board)
    # Ensure the generated position is NOT a valid move
    assume([bad_row, bad_col] not in valid_moves)

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
        session_id = gs.id

    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(player_id), "to_position": [bad_row, bad_col]},
    )
    assert response.status_code == 400, (
        f"Expected 400 for invalid move to [{bad_row},{bad_col}], "
        f"valid moves are {valid_moves}. Got {response.status_code}: {response.text}"
    )
    data = response.json()
    assert "detail" in data
