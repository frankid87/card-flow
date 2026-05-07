# Feature: cardflow-platform, Property 26: Evolution triggered server-side on last row

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


def _create_session(board: list[BoardPieceState], current_turn: str) -> uuid.UUID:
    with Session(test_engine) as db:
        gs = GameSession(
            game_mode="pvp",
            current_turn=current_turn,
            winner=None,
            board_state=[p.model_dump(mode="json") for p in board],
            ai_depth=3,
        )
        db.add(gs)
        db.commit()
        db.refresh(gs)
        return gs.id


# ---------------------------------------------------------------------------
# Property 26
# ---------------------------------------------------------------------------

@given(col=st.integers(min_value=1, max_value=6))
@settings(max_examples=20)
def test_player_piece_evolves_on_row_0(col):
    """
    **Validates: Requirements 17.7**

    A player piece moving to row 0 must have is_evolved=true in the response.
    """
    with Session(test_engine) as db:
        player_id = _make_db_piece(db)
        opp_id = _make_db_piece(db)

    # Player piece at row 1, col — can move diagonally to row 0
    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=[1, col],
            current_hp=50,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_id,
            owner=OwnerEnum.opponent,
            position=[7, 0],  # far away
            current_hp=50,
            is_evolved=False,
        ),
    ]
    session_id = _create_session(board, "player")

    dest = [0, col - 1]  # diagonal forward-left to row 0
    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(player_id), "to_position": dest},
    )
    assert response.status_code == 200, response.text

    data = response.json()
    moved = next(p for p in data["board_state"] if p["piece_id"] == str(player_id))
    assert moved["is_evolved"] is True, (
        f"Player piece at row 0 should be evolved, got is_evolved={moved['is_evolved']}"
    )


@given(col=st.integers(min_value=1, max_value=6))
@settings(max_examples=20)
def test_opponent_piece_evolves_on_row_7(col):
    """
    **Validates: Requirements 17.7**

    An opponent piece moving to row 7 must have is_evolved=true in the response.
    """
    with Session(test_engine) as db:
        player_id = _make_db_piece(db)
        opp_id = _make_db_piece(db)

    # Opponent piece at row 6, col — can move diagonally to row 7
    board = [
        BoardPieceState(
            piece_id=player_id,
            owner=OwnerEnum.player,
            position=[0, 0],  # far away
            current_hp=50,
            is_evolved=False,
        ),
        BoardPieceState(
            piece_id=opp_id,
            owner=OwnerEnum.opponent,
            position=[6, col],
            current_hp=50,
            is_evolved=False,
        ),
    ]
    session_id = _create_session(board, "opponent")

    dest = [7, col - 1]  # diagonal forward (down) to row 7
    response = client.post(
        f"/game/{session_id}/move",
        json={"piece_id": str(opp_id), "to_position": dest},
    )
    assert response.status_code == 200, response.text

    data = response.json()
    moved = next(p for p in data["board_state"] if p["piece_id"] == str(opp_id))
    assert moved["is_evolved"] is True, (
        f"Opponent piece at row 7 should be evolved, got is_evolved={moved['is_evolved']}"
    )
