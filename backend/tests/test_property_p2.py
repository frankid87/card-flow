# Feature: cardflow-platform, Property 2: Artwork list completeness

from fastapi import FastAPI, Depends, status
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.models import Artwork
from app.schemas import ArtworkCreate, ArtworkResponse


# ---------------------------------------------------------------------------
# Minimal test app — single in-memory SQLite DB shared across requests so
# all POSTed artworks are visible to the subsequent GET.
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


@test_app.get("/artworks", response_model=list[ArtworkResponse])
def list_artworks(session: Session = Depends(get_test_session)):
    return session.exec(select(Artwork)).all()


client = TestClient(test_app)


# ---------------------------------------------------------------------------
# Property 2: Artwork list completeness
# ---------------------------------------------------------------------------

@given(
    payloads=st.lists(
        st.fixed_dictionaries({
            "image_url": st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
            "prompt": st.one_of(st.none(), st.text(max_size=200)),
            "seed": st.one_of(st.none(), st.integers(min_value=-(2**31), max_value=2**31 - 1)),
        }),
        min_size=1,
        max_size=10,
    )
)
@settings(max_examples=20, deadline=None)
def test_artwork_list_completeness(payloads):
    """
    **Validates: Requirements 6.2**

    For any set of artworks POSTed to the database, GET /artworks must return
    a list that contains every one of those artworks (by id).
    """
    posted_ids = set()

    for payload in payloads:
        body = {"image_url": payload["image_url"]}
        if payload["prompt"] is not None:
            body["prompt"] = payload["prompt"]
        if payload["seed"] is not None:
            body["seed"] = payload["seed"]

        response = client.post("/artworks", json=body)
        assert response.status_code == 201, (
            f"Expected 201 on POST, got {response.status_code}: {response.text}"
        )
        posted_ids.add(response.json()["id"])

    list_response = client.get("/artworks")
    assert list_response.status_code == 200, (
        f"Expected 200 on GET, got {list_response.status_code}: {list_response.text}"
    )

    returned_ids = {item["id"] for item in list_response.json()}

    assert posted_ids.issubset(returned_ids), (
        f"Missing IDs in GET /artworks response: {posted_ids - returned_ids}"
    )
