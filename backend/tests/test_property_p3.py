# Feature: cardflow-platform, Property 3: Game piece creation round-trip

from fastapi import FastAPI, Depends, status
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
# Minimal test app — single in-memory SQLite DB (StaticPool) so the artwork
# created in setup is visible when the piece endpoint queries it.
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
    from fastapi import HTTPException

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
# Property 3: Game piece creation round-trip
# ---------------------------------------------------------------------------

@given(
    name=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=10_000),
    base_atk=st.integers(min_value=1, max_value=10_000),
    image_url=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
)
@settings(max_examples=100)
def test_game_piece_creation_round_trip(name, element, base_hp, base_atk, image_url):
    """
    **Validates: Requirements 7.1**

    For any valid GamePieceCreate payload referencing an existing artwork,
    POST /pieces must return HTTP 201 with a GamePieceResponse whose fields
    exactly match the submitted values, plus the joined ArtworkResponse.
    """
    # Step 1: create an artwork to get a valid artwork_id
    artwork_resp = client.post("/artworks", json={"image_url": image_url})
    assert artwork_resp.status_code == 201, (
        f"Expected 201 on POST /artworks, got {artwork_resp.status_code}: {artwork_resp.text}"
    )
    artwork_data = artwork_resp.json()
    artwork_id = artwork_data["id"]

    # Step 2: create the game piece referencing that artwork
    payload = {
        "artwork_id": artwork_id,
        "name": name,
        "element": element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }
    response = client.post("/pieces", json=payload)

    # Step 3: assert HTTP 201
    assert response.status_code == 201, (
        f"Expected 201, got {response.status_code}: {response.text}"
    )

    data = response.json()

    # Step 4: assert all submitted fields are echoed back
    assert data["name"] == name
    assert data["element"] == element
    assert data["base_hp"] == base_hp
    assert data["base_atk"] == base_atk
    assert data["artwork_id"] == artwork_id

    # Step 5: assert server-generated id is present
    assert "id" in data

    # Step 6: assert joined artwork fields are populated and match the created artwork
    assert "artwork" in data
    artwork = data["artwork"]
    assert artwork["id"] == artwork_id
    assert artwork["image_url"] == image_url
