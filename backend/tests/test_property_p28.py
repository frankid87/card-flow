# Feature: cardflow-platform, Property 28: Wrong-turn move rejected with 400

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
)
from app.services import session_manager

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
# Property 28
# ---------------------------------------------------------------------------

@given(
    opp_row=st.integers(2, 5),
    opp_col=st.integers(1, 6),
)
@settings(max_examples=20, deadline=None)
def test_wrong_turn_move_rejected_with_400(opp_row, opp_col):
    """
    **Validates: Requirements 17.3**

    Submitting a move for a piece belonging to the non-active player must
    return HTTP 400 with a JSON error body.
    """
    with Session(test_engine) as db:
        player_id = _make_db_piece(db)
        opp_id = _make_db_piece(db)

    # current_turn = "player", but we submit a move for the opponent piece
    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=[6, 3],
            current_hp=50,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_id,
            owner=OwnerEnum.opponent,
            position=[opp_row, opp_col],
            current_hp=50,
            is_evolved=False,
        ),
    ]

    with Session(test_engine) as db:
        gs = GameSession(
            game_mode="pvp",
            current_turn="player",  # player's turn
            winner=None,
            board_state=[p.model_dump(mode="json") for p in board],
            ai_depth=3,
        )
        db.add(gs)
        db.commit()
        db.refresh(gs)
        session_id = gs.id

    # Submit move for opponent piece (wrong turn)
    dest = [opp_row + 1, opp_col - 1]  # any destination — should be rejected before validation
    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(opp_id), "to_position": dest},
    )
    assert response.status_code == 400, (
        f"Expected 400 for wrong-turn move, got {response.status_code}: {response.text}"
    )
    data = response.json()
    assert "detail" in data
