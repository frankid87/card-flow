import os
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import SQLModel, create_engine
from starlette.responses import JSONResponse

from app.routers.artworks import router as artworks_router
from app.routers.pieces import router as pieces_router
from app.auth import create_access_token, verify_token, VALID_API_KEY

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "Please configure it before starting the server."
    )

engine = create_engine(DATABASE_URL)

app = FastAPI(title="CardFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine, checkfirst=True)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )


@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Exchange API key for a JWT. Use the API key as the password field."""
    if form_data.password != VALID_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    token = create_access_token({"sub": "cardflow-client"})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/health")
def health():
    return {"status": "ok"}


# Protected routers
app.include_router(artworks_router, dependencies=[Depends(verify_token)])
app.include_router(pieces_router, dependencies=[Depends(verify_token)])
