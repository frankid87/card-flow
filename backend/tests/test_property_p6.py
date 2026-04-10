# Feature: cardflow-platform, Property 6: Multiple game pieces can share an artwork

import uuid

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

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
# Property 6: Multiple game pieces can share an artwork
# ---------------------------------------------------------------------------

@given(
    image_url=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    pieces_data=st.lists(
        st.tuples(
            st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
            st.sampled_from(ELEMENTS),
            st.integers(min_value=1, max_value=10_000),
            st.integers(min_value=1, max_value=10_000),
        ),
        min_size=2,
        max_size=10,
    ),
)
@settings(max_examples=100, deadline=None)
def test_multiple_pieces_can_share_artwork(image_url, pieces_data):
    """
    **Validates: Requirements 2.4**

    For any existing artwork, N GamePiece records can all reference the same
    artwork_id without any constraint violation.
    """
    # Create one artwork
    artwork_resp = client.post("/artworks", json={"image_url": image_url})
    assert artwork_resp.status_code == 201, (
        f"Failed to create artwork: {artwork_resp.text}"
    )
    artwork_id = artwork_resp.json()["id"]

    # POST N pieces all referencing the same artwork_id
    created_ids = []
    for name, element, base_hp, base_atk in pieces_data:
        payload = {
            "artwork_id": artwork_id,
            "name": name,
            "element": element,
            "base_hp": base_hp,
            "base_atk": base_atk,
        }
        resp = client.post("/pieces", json=payload)
        assert resp.status_code == 201, (
            f"Expected 201 creating piece referencing artwork {artwork_id}, "
            f"got {resp.status_code}: {resp.text}"
        )
        body = resp.json()
        assert body["artwork_id"] == artwork_id, (
            f"Expected artwork_id {artwork_id} in response, got {body['artwork_id']}"
        )
        created_ids.append(body["id"])

    # All pieces should have distinct IDs
    assert len(created_ids) == len(set(created_ids)), (
        "Expected all created piece IDs to be unique"
    )
