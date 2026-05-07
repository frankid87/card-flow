from typing import List
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.auth import verify_token
from app.models import Artwork, GamePiece
from app.schemas import GamePieceCreate, GamePieceResponse, ArtworkResponse

router = APIRouter(prefix="/pieces", tags=["pieces"])


def get_session():
    from app.main import engine
    with Session(engine) as session:
        yield session


def _to_response(piece: GamePiece, artwork: Artwork) -> GamePieceResponse:
    return GamePieceResponse(
        id=piece.id,
        artwork_id=piece.artwork_id,
        name=piece.name,
        element=piece.element,
        base_hp=piece.base_hp,
        base_atk=piece.base_atk,
        artwork=ArtworkResponse.model_validate(artwork),
    )


@router.post("", response_model=GamePieceResponse, status_code=status.HTTP_201_CREATED)
def create_piece(
    piece_in: GamePieceCreate,
    session: Session = Depends(get_session),
    user_id: str = Depends(verify_token),
):
    artwork = session.get(Artwork, piece_in.artwork_id)
    if not artwork:
        raise HTTPException(status_code=404, detail="Artwork not found")

    piece = GamePiece(
        artwork_id=piece_in.artwork_id,
        name=piece_in.name,
        element=piece_in.element,
        base_hp=piece_in.base_hp,
        base_atk=piece_in.base_atk,
        owner_user_id=user_id,
    )
    session.add(piece)
    session.commit()
    session.refresh(piece)
    return _to_response(piece, artwork)


@router.get("", response_model=List[GamePieceResponse], status_code=status.HTTP_200_OK)
def list_pieces(
    session: Session = Depends(get_session),
    user_id: str = Depends(verify_token),
):
    """Return pieces owned by the authenticated user."""
    pieces = session.exec(
        select(GamePiece).where(GamePiece.owner_user_id == user_id)
    ).all()
    result = []
    for piece in pieces:
        artwork = session.get(Artwork, piece.artwork_id)
        if artwork:
            result.append(_to_response(piece, artwork))
    return result


@router.post("/by-ids", response_model=List[GamePieceResponse], status_code=status.HTTP_200_OK)
def get_pieces_by_ids(
    ids: List[uuid.UUID],
    session: Session = Depends(get_session),
    _: str = Depends(verify_token),
):
    """Return pieces by a list of IDs (used to load opponent pieces for board rendering)."""
    result = []
    for piece_id in ids:
        piece = session.get(GamePiece, piece_id)
        if piece:
            artwork = session.get(Artwork, piece.artwork_id)
            if artwork:
                result.append(_to_response(piece, artwork))
    return result


@router.get("/by-ids", response_model=List[GamePieceResponse], status_code=status.HTTP_200_OK)
def get_pieces_by_ids(
    ids: str,  # comma-separated UUIDs
    session: Session = Depends(get_session),
    _: str = Depends(verify_token),
):
    """Fetch any pieces by ID (used to load opponent pieces for display)."""
    import uuid as _uuid
    try:
        id_list = [_uuid.UUID(i.strip()) for i in ids.split(",") if i.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID in ids")
    result = []
    for pid in id_list:
        piece = session.get(GamePiece, pid)
        if piece:
            artwork = session.get(Artwork, piece.artwork_id)
            if artwork:
                result.append(_to_response(piece, artwork))
    return result
