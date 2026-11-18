from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite:///./dev.db"
    redis_url: str = "redis://localhost:6379/0"
    # "celery" dispatches to Celery workers; "inline" runs jobs in a thread pool (local development only).
    worker_mode: str = "celery"

    # Fernet key (urlsafe base64, 32 bytes) used to encrypt stored integration credentials.
    secret_encryption_key: str = ""
    owner_email: str = ""
    owner_password: str = ""
    session_hours: int = 72
    cookie_secure: bool = True
    public_base_url: str = "http://localhost:3000"
    upload_dir: str = "./data/uploads"

    # Telegram Mini App. The bot token never leaves server-side processes.
    telegram_bot_token: str = ""
    telegram_owner_id: str = ""
    telegram_mini_app_url: str = ""
    telegram_init_data_max_age_seconds: int = 900

    # Hermes API servers (pinned image, see docker-compose.yml).
    hermes_research_url: str = ""
    hermes_research_key: str = ""
    hermes_writer_url: str = ""
    hermes_writer_key: str = ""
    hermes_version_pin: str = "v0.23.2"
    hermes_run_timeout_seconds: int = 900
    hermes_poll_seconds: float = 2.0
    # True only when the URLs above point at the bundled contract stub; every screen is then labelled DEMO.
    hermes_is_stub: bool = False

    # Which providers have server-side keys present in the Hermes containers.
    openai_configured: bool = False
    kimi_configured: bool = False
    gemini_configured: bool = False
    gemini_default_model: str = "gemini-3.5-flash-lite"
    hermes_openai_provider: str = "openai-api"
    hermes_kimi_provider: str = "kimi-coding"
    hermes_gemini_provider: str = "gemini"

    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant: str = "common"

    default_timezone: str = "Asia/Dhaka"
    fetch_timeout_seconds: float = 15.0
    fetch_max_bytes: int = 1_500_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
