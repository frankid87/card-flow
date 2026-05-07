# Feature: cardflow-platform, Property 22: Session creation round-trip

import uuid

from fastapi import FastAPI, Depends, status
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork, GamePiece, GameSession
from app.schemas import (
    ArtworkResponse,
    BoardPieceState,
    GameModeEnum,
    GamePieceResponse,
    MoveRequest,
    OwnerEnum,
    SessionCreateRequest,
    SessionResponse,
    ValidMovesResponse,
)
from app.services import session_manager

# ---------------------------------------------------------------------------
# Shared test app
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


@test_app.post("/game/session", response_model=SessionResponse, status_code=201)
def create_session(body: SessionCreateRequest, db: Session = Depends(get_db)):
    gs = session_manager.create_session(body, db)
    return _to_response(gs)


client = TestClient(test_app)

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


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


# ---------------------------------------------------------------------------
# Property 22
# ---------------------------------------------------------------------------

@given(
    n_player=st.integers(min_value=1, max_value=3),
    n_opponent=st.integers(min_value=1, max_value=3),
    game_mode=st.sampled_from(["pvp", "pvc"]),
    base_hp=st.integers(min_value=1, max_value=50),
)
@settings(max_examples=20)
def test_session_creation_round_trip(n_player, n_opponent, game_mode, base_hp):
    """
    **Validates: Requirements 15.1, 15.2, 15.4**

    For any valid SessionCreateRequest with existing pieces, POST /game/session
    must return a SessionResponse whose board_state contains all pieces with
    correct initial HP, is_evolved=false, and positions in the correct rows.
    """
    with Session(test_engine) as db:
        player_ids = [str(_make_piece(db, base_hp=base_hp)) for _ in range(n_player)]
        opponent_ids = [str(_make_piece(db, base_hp=base_hp)) for _ in range(n_opponent)]

    payload = {
        "player_piece_ids": player_ids,
        "opponent_piece_ids": opponent_ids,
        "game_mode": game_mode,
    }
    response = client.post("/game/session", json=payload)
    assert response.status_code == 201, response.text

    data = response.json()
    assert data["current_turn"] == "player"
    assert data["winner"] is None
    assert data["game_mode"] == game_mode

    board = data["board_state"]
    returned_ids = {p["piece_id"] for p in board}

    # All submitted piece IDs must appear in board_state
    for pid in player_ids + opponent_ids:
        assert pid in returned_ids, f"Piece {pid} missing from board_state"

    # Validate per-piece invariants
    for piece in board:
        assert piece["is_evolved"] is False
        assert piece["current_hp"] == base_hp

        row = piece["position"][0]
        if piece["owner"] == "player":
            assert 5 <= row <= 7, f"Player piece at row {row}, expected 5-7"
        else:
            assert 0 <= row <= 2, f"Opponent piece at row {row}, expected 0-2"
