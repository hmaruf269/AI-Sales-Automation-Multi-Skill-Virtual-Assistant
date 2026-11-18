import hashlib
import hmac
import json
from datetime import datetime, timezone
from urllib.parse import urlencode

import pytest

from app.security import validate_telegram_init_data


TOKEN = "123456:test-token"
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)


def signed_init_data(*, user_id: int = 42, auth_date: int | None = None) -> str:
    values = {
        "auth_date": str(auth_date if auth_date is not None else int(NOW.timestamp())),
        "query_id": "AAE-test-query",
        "user": json.dumps({"id": user_id, "first_name": "Owner"}, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


def test_valid_telegram_init_data_returns_signed_user():
    user = validate_telegram_init_data(signed_init_data(), TOKEN, now=NOW)
    assert user == {"id": 42, "first_name": "Owner"}


def test_tampered_telegram_init_data_is_rejected():
    data = signed_init_data().replace("Owner", "Attacker")
    with pytest.raises(ValueError, match="signature"):
        validate_telegram_init_data(data, TOKEN, now=NOW)


def test_expired_telegram_init_data_is_rejected():
    data = signed_init_data(auth_date=int(NOW.timestamp()) - 901)
    with pytest.raises(ValueError, match="expired"):
        validate_telegram_init_data(data, TOKEN, now=NOW, max_age_seconds=900)


def test_duplicate_telegram_fields_are_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        validate_telegram_init_data(signed_init_data() + "&auth_date=1", TOKEN, now=NOW)
