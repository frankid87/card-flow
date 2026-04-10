# Feature: cardflow-platform, Property 11: HTTP exceptions return correct status code with JSON

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from hypothesis import given, settings
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Minimal test app — registers the same HTTPException handler as main.py
# so we can exercise it without needing DATABASE_URL or a real database.
# ---------------------------------------------------------------------------

test_app = FastAPI()


@test_app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@test_app.get("/raise-http")
def raise_http(status_code: int = 400, detail: str = "error"):
    raise HTTPException(status_code=status_code, detail=detail)


client = TestClient(test_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Property 11: HTTP exceptions return correct status code with JSON
# ---------------------------------------------------------------------------

@given(
    status_code=st.integers(min_value=400, max_value=599),
    detail=st.text(min_size=1, max_size=200),
)
@settings(max_examples=100)
def test_http_exception_returns_correct_status_and_json(status_code, detail):
    """
    **Validates: Requirements 8.3**

    For any HTTPException raised with a specific 4xx or 5xx status code,
    the global exception handler must return that exact status code with a
    JSON body containing a 'detail' field — never HTML.
    """
    response = client.get(
        "/raise-http",
        params={"status_code": status_code, "detail": detail},
    )

    assert response.status_code == status_code, (
        f"Expected status {status_code}, got {response.status_code}"
    )

    # Must be JSON, not HTML
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type, (
        f"Expected JSON content-type, got: {content_type}"
    )

    data = response.json()
    assert "detail" in data, f"Response JSON missing 'detail': {data}"
    assert data["detail"] == detail, (
        f"Expected detail={detail!r}, got {data['detail']!r}"
    )
