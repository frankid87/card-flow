# Feature: cardflow-platform, Property 9: Invalid request bodies return 422

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from app.schemas import ArtworkCreate, GamePieceCreate


# ---------------------------------------------------------------------------
# Minimal test app — uses the real Pydantic schemas so FastAPI's built-in
# 422 validation is exercised without needing a live database.
# ---------------------------------------------------------------------------

test_app = FastAPI()

ELEMENTS = ["Fire", "Grass", "Water", "Electric", "Air", "Earth", "Neutral"]


@test_app.post("/artworks", status_code=201)
def create_artwork(body: ArtworkCreate):
    return {"image_url": body.image_url}


@test_app.post("/pieces", status_code=201)
def create_piece(body: GamePieceCreate):
    return {"artwork_id": str(body.artwork_id)}


client = TestClient(test_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Category 1: Missing required fields
# ---------------------------------------------------------------------------

@given(
    prompt=st.one_of(st.none(), st.text(max_size=200)),
    seed=st.one_of(st.none(), st.integers()),
)
@settings(max_examples=100)
def test_post_artworks_missing_image_url_returns_422(prompt, seed):
    """
    **Validates: Requirements 5.7**

    POST /artworks with image_url omitted must return HTTP 422 with a JSON
    body containing a 'detail' field.
    """
    body: dict = {}
    if prompt is not None:
        body["prompt"] = prompt
    if seed is not None:
        body["seed"] = seed

    response = client.post("/artworks", json=body)

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


@given(
    missing_field=st.sampled_from(
        ["artwork_id", "name", "element", "base_hp", "base_atk"]
    ),
    name=st.text(min_size=1, max_size=100),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=1000),
    base_atk=st.integers(min_value=1, max_value=1000),
)
@settings(max_examples=100)
def test_post_pieces_missing_required_field_returns_422(
    missing_field, name, element, base_hp, base_atk
):
    """
    **Validates: Requirements 5.7**

    POST /pieces with any required field omitted must return HTTP 422 with a
    JSON body containing a 'detail' field.
    """
    full_body = {
        "artwork_id": str(uuid.uuid4()),
        "name": name,
        "element": element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }
    del full_body[missing_field]

    response = client.post("/pieces", json=full_body)

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


# ---------------------------------------------------------------------------
# Category 2: Wrong types
# ---------------------------------------------------------------------------

@given(
    base_hp_str=st.text(min_size=1, max_size=20).filter(
        lambda s: not s.lstrip("-").isdigit()
    ),
    name=st.text(min_size=1, max_size=100),
    element=st.sampled_from(ELEMENTS),
    base_atk=st.integers(min_value=1, max_value=1000),
)
@settings(max_examples=100)
def test_post_pieces_wrong_type_base_hp_returns_422(
    base_hp_str, name, element, base_atk
):
    """
    **Validates: Requirements 5.8**

    POST /pieces with base_hp as a non-numeric string must return HTTP 422
    with a JSON body containing a 'detail' field.
    """
    body = {
        "artwork_id": str(uuid.uuid4()),
        "name": name,
        "element": element,
        "base_hp": base_hp_str,
        "base_atk": base_atk,
    }

    response = client.post("/pieces", json=body)

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


@given(
    artwork_id_int=st.integers(min_value=1, max_value=10**9),
    name=st.text(min_size=1, max_size=100),
    element=st.sampled_from(ELEMENTS),
    base_hp=st.integers(min_value=1, max_value=1000),
    base_atk=st.integers(min_value=1, max_value=1000),
)
@settings(max_examples=100)
def test_post_pieces_wrong_type_artwork_id_returns_422(
    artwork_id_int, name, element, base_hp, base_atk
):
    """
    **Validates: Requirements 5.8**

    POST /pieces with artwork_id as an integer (not a UUID string) must
    return HTTP 422 with a JSON body containing a 'detail' field.
    """
    body = {
        "artwork_id": artwork_id_int,
        "name": name,
        "element": element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }

    response = client.post("/pieces", json=body)

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


# ---------------------------------------------------------------------------
# Category 3: Invalid element enum values
# ---------------------------------------------------------------------------

INVALID_ELEMENT_EXAMPLES = [
    "fire",       # wrong case
    "FIRE",       # all caps
    "Lightning",  # not in enum
    "Normal",     # not in enum
    "",           # empty string
    "fire grass", # space-separated
    "123",        # numeric string
]


@given(
    invalid_element=st.text(max_size=50).filter(
        lambda s: s not in ELEMENTS
    ),
    name=st.text(min_size=1, max_size=100),
    base_hp=st.integers(min_value=1, max_value=1000),
    base_atk=st.integers(min_value=1, max_value=1000),
)
@settings(max_examples=100)
def test_post_pieces_invalid_element_returns_422(
    invalid_element, name, base_hp, base_atk
):
    """
    **Validates: Requirements 5.9**

    POST /pieces with an element value not in the valid enum
    (Fire, Grass, Water, Electric, Air, Earth, Neutral) must return
    HTTP 422 with a JSON body containing a 'detail' field.
    """
    body = {
        "artwork_id": str(uuid.uuid4()),
        "name": name,
        "element": invalid_element,
        "base_hp": base_hp,
        "base_atk": base_atk,
    }

    response = client.post("/pieces", json=body)

    assert response.status_code == 422
    data = response.json()
    assert "detail" in data
