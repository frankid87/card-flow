# Feature: cardflow-platform, Property 1: Artwork creation round-trip

from fastapi import FastAPI, Depends, status
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Artwork
from app.schemas import ArtworkCreate, ArtworkResponse


# ---------------------------------------------------------------------------
# Minimal test app — uses a real in-memory SQLite DB (StaticPool keeps a
# single connection alive so the schema persists across requests) so the full
# persistence round-trip is tested without needing DATABASE_URL.
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


client = TestClient(test_app)


# ---------------------------------------------------------------------------
# Property 1: Artwork creation round-trip
# ---------------------------------------------------------------------------

@given(
    image_url=st.text(min_size=1, max_size=500).filter(lambda s: s.strip()),
    prompt=st.one_of(st.none(), st.text(max_size=500)),
    seed=st.one_of(st.none(), st.integers(min_value=-(2**31), max_value=2**31 - 1)),
)
@settings(max_examples=100)
def test_artwork_creation_round_trip(image_url, prompt, seed):
    """
    **Validates: Requirements 6.1**

    For any valid ArtworkCreate payload (non-empty image_url, optional prompt
    and seed), POST /artworks must return HTTP 201 with a response body whose
    image_url, prompt, and seed fields exactly match the submitted values.
    """
    payload: dict = {"image_url": image_url}
    if prompt is not None:
        payload["prompt"] = prompt
    if seed is not None:
        payload["seed"] = seed

    response = client.post("/artworks", json=payload)

    assert response.status_code == 201, (
        f"Expected 201, got {response.status_code}: {response.text}"
    )

    data = response.json()

    # Response must echo back the submitted fields
    assert data["image_url"] == image_url
    assert data.get("prompt") == prompt
    assert data.get("seed") == seed

    # Response must include server-generated fields
    assert "id" in data
    assert "created_at" in data
