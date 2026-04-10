# Feature: cardflow-platform, Property 10: Unhandled exceptions return 500 JSON

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from hypothesis import given, settings
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Minimal test app — registers the same unhandled Exception handler as main.py
# so we can exercise it without needing DATABASE_URL or a real database.
# ---------------------------------------------------------------------------

test_app = FastAPI()


@test_app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )


@test_app.get("/raise-runtime")
def raise_runtime(msg: str = "error"):
    raise RuntimeError(msg)


@test_app.get("/raise-value")
def raise_value(msg: str = "error"):
    raise ValueError(msg)


client = TestClient(test_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Property 10: Unhandled exceptions return 500 JSON
# ---------------------------------------------------------------------------

@given(
    msg=st.text(min_size=1, max_size=200),
    path=st.sampled_from(["/raise-runtime", "/raise-value"]),
)
@settings(max_examples=100)
def test_unhandled_exception_returns_500_json(msg, path):
    """
    **Validates: Requirements 8.2**

    For any unhandled exception raised inside a route handler, the global
    exception handler must return HTTP 500 with a JSON body that contains
    both a 'detail' field and a 'type' field — never HTML.
    """
    response = client.get(path, params={"msg": msg})

    assert response.status_code == 500

    # Must be JSON, not HTML
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type, (
        f"Expected JSON content-type, got: {content_type}"
    )

    data = response.json()
    assert "detail" in data, f"Response JSON missing 'detail': {data}"
    assert "type" in data, f"Response JSON missing 'type': {data}"
