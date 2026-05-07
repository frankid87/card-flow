import os
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlmodel import SQLModel, Session, create_engine, select
from starlette.responses import JSONResponse

from app.routers.artworks import router as artworks_router
from app.routers.pieces import router as pieces_router
from app.routers.game import router as game_router
from app.auth import (
    create_access_token, verify_token, VALID_API_KEY,
    hash_password, verify_password,
)
from app.models import User

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "Please configure it before starting the server."
    )

engine = create_engine(DATABASE_URL)


def get_session():
    with Session(engine) as session:
        yield session


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


class RegisterRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_session)):
    """Register a new user account."""
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    existing = db.exec(select(User).where(User.username == body.username)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    user = User(username=body.username, hashed_password=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"username": user.username}


@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_session)):
    """Login with username + password, or use the legacy API key as password."""
    # Legacy API key login (admin / backward compat)
    if form_data.password == VALID_API_KEY:
        token = create_access_token({"sub": form_data.username or "cardflow-client"})
        return {"access_token": token, "token_type": "bearer"}

    # Per-user login
    user = db.exec(select(User).where(User.username == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/health")
def health():
    return {"status": "ok"}


# Protected routers
app.include_router(artworks_router, dependencies=[Depends(verify_token)])
app.include_router(pieces_router, dependencies=[Depends(verify_token)])
app.include_router(game_router)
