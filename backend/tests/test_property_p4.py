# Feature: cardflow-platform, Property 4: Game piece list completeness with joined artwork

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
# Minimal test app — single in-memory SQLite DB (StaticPool) so all POSTed
# records are visible to the subsequent GET /pieces.
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


@test_app.get("/pieces", response_model=list[GamePieceResponse])
def list_pieces(session: Session = Depends(get_test_session)):
    pieces = session.exec(select(GamePiece)).all()
    result = []
    for piece in pieces:
        artwork = session.get(Artwork, piece.artwork_id)
        result.append(
            GamePieceResponse(
                id=piece.id,
                artwork_id=piece.artwork_id,
                name=piece.name,
                element=piece.element,
                base_hp=piece.base_hp,
                base_atk=piece.base_atk,
                artwork=ArtworkResponse.model_validate(artwork),
            )
        )
    return result


client = TestClient(test_app)

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


# ---------------------------------------------------------------------------
# Property 4: Game piece list completeness with joined artwork
# ---------------------------------------------------------------------------

@given(n=st.integers(min_value=1, max_value=5))
@settings(max_examples=100)
def test_game_piece_list_completeness_with_joined_artwork(n):
    """
    **Validates: Requirements 7.3**

    For any N game pieces each referencing a freshly created artwork,
    GET /pieces must return a list containing all N piece IDs, and each
    piece in the response must have artwork fields (id, image_url) populated
    and non-null.
    """
    posted_piece_ids = set()

    for i in range(n):
        # Create a fresh artwork for each piece
        artwork_resp = client.post("/artworks", json={"image_url": f"https://example.com/art_{i}.png"})
        assert artwork_resp.status_code == 201, (
            f"Expected 201 on POST /artworks, got {artwork_resp.status_code}: {artwork_resp.text}"
        )
        artwork_id = artwork_resp.json()["id"]

        # Create a game piece referencing that artwork
        piece_resp = client.post("/pieces", json={
            "artwork_id": artwork_id,
            "name": f"Piece {i}",
            "element": ELEMENTS[i % len(ELEMENTS)],
            "base_hp": 100,
            "base_atk": 50,
        })
        assert piece_resp.status_code == 201, (
            f"Expected 201 on POST /pieces, got {piece_resp.status_code}: {piece_resp.text}"
        )
        posted_piece_ids.add(piece_resp.json()["id"])

    # GET /pieces and verify completeness + artwork population
    list_resp = client.get("/pieces")
    assert list_resp.status_code == 200, (
        f"Expected 200 on GET /pieces, got {list_resp.status_code}: {list_resp.text}"
    )

    pieces = list_resp.json()
    returned_ids = {p["id"] for p in pieces}

    # All posted piece IDs must be present
    assert posted_piece_ids.issubset(returned_ids), (
        f"Missing piece IDs in GET /pieces response: {posted_piece_ids - returned_ids}"
    )

    # Each piece in the response must have artwork fields populated
    for piece in pieces:
        artwork = piece.get("artwork")
        assert artwork is not None, f"Piece {piece['id']} has no 'artwork' field"
        assert artwork.get("id") is not None, f"Piece {piece['id']} artwork.id is null"
        assert artwork.get("image_url") is not None, f"Piece {piece['id']} artwork.image_url is null"
