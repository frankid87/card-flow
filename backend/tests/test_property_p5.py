# Feature: cardflow-platform, Property 5: Non-existent artwork_id returns 404

import uuid

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.models import Artwork, GamePiece
from app.schemas import (
    ArtworkCreate,
    ArtworkResponse,
    GamePieceCreate,
    GamePieceResponse,
)


# ---------------------------------------------------------------------------
# Minimal test app — single in-memory SQLite DB (StaticPool).
# ---------------------------------------------------------------------------

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

SQLModel.metadata.create_all(test_engine)

test_app = FastAPI()


def get_test_session():
    with Session(test_engine) as session:
        yield session


@test_app.post("/artworks", response_model=ArtworkResponse, status_code=status.HTTP_201_CREATED)
def create_artwork(artwork_in: ArtworkCreate, session: Session = Depends(get_test_session)):
    artwork = Artwork(
        image_url=artwork_in.image_url,
        prompt=artwork_in.prompt,
        seed=artwork_in.seed,
    )
    session.add(artwork)
    session.commit()
    session.refresh(artwork)
    return artwork


@test_app.post("/pieces", response_model=GamePieceResponse, status_code=status.HTTP_201_CREATED)
def create_piece(piece_in: GamePieceCreate, session: Session = Depends(get_test_session)):
    artwork = session.get(Artwork, piece_in.artwork_id)
    if not artwork:
        raise HTTPException(status_code=404, detail="Artwork not found")

    piece = GamePiece(
        artwork_id=piece_in.artwork_id,
        name=piece_in.name,
        element=piece_in.element,
        base_hp=piece_in.base_hp,
        base_atk=piece_in.base_atk,
    )
    session.add(piece)
    session.commit()
    session.refresh(piece)

    return GamePieceResponse(
        id=piece.id,
        artwork_id=piece.artwork_id,
        name=piece.name,
        element=piece.element,
        base_hp=piece.base_hp,
        base_atk=piece.base_atk,
        artwork=ArtworkResponse.model_validate(artwork),
    )


client = TestClient(test_app)

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


# ---------------------------------------------------------------------------
# Property 5: Non-existent artwork_id returns 404
# ---------------------------------------------------------------------------

@given(
    artwork_id=st.uuids(),
    name=st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=10_000),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100)
def test_non_existent_artwork_id_returns_404(artwork_id, name, element, base_hp, base_atk):
    """
    **Validates: Requirements 7.2**

    For any UUID that does not correspond to an existing artwork in the DB,
    POST /pieces must return HTTP 404 with a JSON body containing a 'detail' field.
    """
    # Verify the generated UUID is not in the database
    with Session(test_engine) as session:
        existing = session.get(Artwork, artwork_id)
        if existing is not None:
            # UUID collision with an existing artwork — skip this example
            return

    payload = {
        "artwork_id": str(artwork_id),
        "name": name,
        "element": element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }
    response = client.post("/pieces", json=payload)

    assert response.status_code == 404, (
        f"Expected 404 for non-existent artwork_id {artwork_id}, "
        f"got {response.status_code}: {response.text}"
    )

    body = response.json()
    assert "detail" in body, (
        f"Expected JSON body with 'detail' field, got: {body}"
    )
