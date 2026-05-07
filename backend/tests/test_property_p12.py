# Feature: cardflow-platform, Property 12: Artwork record unchanged after game piece creation

from fastapi import FastAPI, Depends, status, HTTPException
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork, GamePiece
from app.schemas import ArtworkCreate, ArtworkResponse, GamePieceCreate, GamePieceResponse


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


@test_app.get("/artworks/{artwork_id}", response_model=ArtworkResponse)
def get_artwork(artwork_id: str, session: Session = Depends(get_test_session)):
    import uuid
    artwork = session.get(Artwork, uuid.UUID(artwork_id))
    if not artwork:
        raise HTTPException(status_code=404, detail="Artwork not found")
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
# Property 12: Artwork record unchanged after game piece creation
# ---------------------------------------------------------------------------

@given(
    image_url=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    prompt=st.one_of(st.none(), st.text(min_size=1, max_size=200)),
    seed=st.one_of(st.none(), st.integers(min_value=0, max_value=2**31 - 1)),
    name=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=10_000),
    base_atk=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=20, deadline=None)
def test_artwork_record_unchanged_after_piece_creation(
    image_url, prompt, seed, name, element, base_hp, base_atk
):
    """
    **Validates: Requirements 13.2**

    For any artwork record, after creating a GamePiece that references it,
    the artwork's fields (image_url, prompt, seed, created_at) must be
    identical to their values before the operation.
    """
    # Step 1: create an artwork
    artwork_payload = {"image_url": image_url, "prompt": prompt, "seed": seed}
    create_resp = client.post("/artworks", json=artwork_payload)
    assert create_resp.status_code == 201, (
        f"Expected 201 on POST /artworks, got {create_resp.status_code}: {create_resp.text}"
    )
    artwork_before = create_resp.json()
    artwork_id = artwork_before["id"]

    # Step 2: create a game piece referencing that artwork
    piece_payload = {
        "artwork_id": artwork_id,
        "name": name,
        "element": element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }
    piece_resp = client.post("/pieces", json=piece_payload)
    assert piece_resp.status_code == 201, (
        f"Expected 201 on POST /pieces, got {piece_resp.status_code}: {piece_resp.text}"
    )

    # Step 3: fetch the artwork again
    get_resp = client.get(f"/artworks/{artwork_id}")
    assert get_resp.status_code == 200, (
        f"Expected 200 on GET /artworks/{artwork_id}, got {get_resp.status_code}: {get_resp.text}"
    )
    artwork_after = get_resp.json()

    # Step 4: assert all fields are unchanged
    assert artwork_after["image_url"] == artwork_before["image_url"]
    assert artwork_after["prompt"] == artwork_before["prompt"]
    assert artwork_after["seed"] == artwork_before["seed"]
    assert artwork_after["created_at"] == artwork_before["created_at"]
    assert artwork_after["id"] == artwork_before["id"]
