import base64
import hashlib
import hmac
import json
import logging
import secrets
import sys
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db, utcnow
from app.models import AuthSession, LoginAttempt, Owner

SESSION_COOKIE = "assistant_session"
_SCRYPT = {"n": 2**15, "r": 8, "p": 1}


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("workflow_run_id", "hermes_run_id", "account_id", "message_id", "event"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, maxmem=2**27, **_SCRYPT)
    return "scrypt$%d$%d$%d$%s$%s" % (
        _SCRYPT["n"], _SCRYPT["r"], _SCRYPT["p"],
        base64.b64encode(salt).decode(), base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected), maxmem=2**27
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _fernet() -> Fernet:
    key = get_settings().secret_encryption_key
    if not key:
        raise RuntimeError("SECRET_ENCRYPTION_KEY is not set; credentials cannot be stored.")
    return Fernet(key.encode())


def encrypt_json(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_json(token: str) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except InvalidToken as exc:
        raise RuntimeError("Stored credentials cannot be decrypted with the current SECRET_ENCRYPTION_KEY.") from exc


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def ensure_owner(db: Session) -> None:
    """Create the single owner from OWNER_EMAIL / OWNER_PASSWORD on first start."""
    s = get_settings()
    if db.scalar(select(Owner).limit(1)) or not (s.owner_email and s.owner_password):
        return
    if len(s.owner_password) < 12:
        raise RuntimeError("OWNER_PASSWORD must be at least 12 characters.")
    db.add(Owner(email=s.owner_email.strip().lower(), password_hash=hash_password(s.owner_password)))
    db.commit()


def login(db: Session, email: str, password: str, ip: str) -> tuple[str, str]:
    window = utcnow() - timedelta(minutes=15)
    recent = db.query(LoginAttempt).filter(LoginAttempt.ip == ip, LoginAttempt.created_at > window).count()
    if recent >= 10:
        raise HTTPException(429, "Too many sign-in attempts. Try again in 15 minutes.")
    owner = db.scalar(select(Owner).where(Owner.email == email.strip().lower()))
    # Hash even when the owner is unknown so timing does not reveal which emails exist.
    ok = verify_password(password, owner.password_hash if owner else hash_password("placeholder-password"))
    if not owner or not ok:
        db.add(LoginAttempt(ip=ip))
        db.commit()
        raise HTTPException(401, "Incorrect email or password.")
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    db.add(AuthSession(
        owner_id=owner.id, token_hash=_token_hash(token), csrf_token=csrf,
        expires_at=utcnow() + timedelta(hours=get_settings().session_hours),
    ))
    db.commit()
    return token, csrf


def logout(db: Session, token: str | None) -> None:
    if token:
        db.query(AuthSession).filter(AuthSession.token_hash == _token_hash(token)).delete()
        db.commit()


def current_session(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    csrf: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> AuthSession:
    if not token:
        raise HTTPException(401, "Sign in required.")
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if not session or session.expires_at < utcnow():
        raise HTTPException(401, "Session expired. Sign in again.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not csrf or not hmac.compare_digest(csrf, session.csrf_token):
            raise HTTPException(403, "Missing or invalid CSRF token.")
    return session
