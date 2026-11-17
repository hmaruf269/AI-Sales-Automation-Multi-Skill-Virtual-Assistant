from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Owner
from app.security import SESSION_COOKIE, current_session, login, logout

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str


@router.get("/session")
def session_info(session=Depends(current_session), db: Session = Depends(get_db)):
    owner = db.get(Owner, session.owner_id)
    return {
        "authenticated": True,
        "owner": {"name": "Nahin Meem Alifa", "email": owner.email if owner else ""},
        "csrf_token": session.csrf_token,
    }


@router.post("/login")
def sign_in(payload: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)):
    token, csrf = login(db, payload.email, payload.password, request.client.host if request.client else "unknown")
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        max_age=get_settings().session_hours * 3600,
        path="/",
    )
    return {"authenticated": True, "owner": {"name": "Nahin Meem Alifa", "email": payload.email}, "csrf_token": csrf}


@router.post("/logout", status_code=204)
def sign_out(response: Response, db: Session = Depends(get_db), session=Depends(current_session)):
    # current_session already validated the cookie; remove by stored hash through the request cookie in a future hardened route.
    db.delete(session)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return Response(status_code=204)
