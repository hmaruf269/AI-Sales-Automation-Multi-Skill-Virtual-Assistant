"""Small owner-only Telegram bot that launches the full Mini App."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import get_settings
from app.security import configure_logging

log = logging.getLogger("telegram-bot")


class TelegramBot:
    def __init__(self, token: str, mini_app_url: str, owner_id: str = ""):
        self.base_url = f"https://api.telegram.org/bot{token}"
        self.mini_app_url = mini_app_url.strip()
        self.owner_id = owner_id.strip()
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(40, connect=10))

    async def call(self, method: str, payload: dict[str, Any] | None = None) -> Any:
        try:
            response = await self.client.post(f"{self.base_url}/{method}", json=payload or {})
            body = response.json()
        except Exception as exc:
            raise RuntimeError(f"Telegram API request failed ({type(exc).__name__}).") from exc
        if not response.is_success or not body.get("ok"):
            raise RuntimeError(f"Telegram API rejected {method}: {body.get('description', response.status_code)}")
        return body.get("result")

    def app_markup(self) -> dict[str, Any] | None:
        if not self.mini_app_url.startswith("https://"):
            return None
        return {"inline_keyboard": [[{"text": "Open Nexa Sales AI", "web_app": {"url": self.mini_app_url}}]]}

    async def setup(self) -> None:
        await self.call("setMyCommands", {"commands": [
            {"command": "start", "description": "Open Nexa Sales AI"},
            {"command": "app", "description": "Launch the Mini App"},
            {"command": "status", "description": "Check bot configuration"},
            {"command": "help", "description": "Show help"},
        ]})
        if self.mini_app_url.startswith("https://"):
            await self.call("setChatMenuButton", {"menu_button": {
                "type": "web_app", "text": "Open Nexa", "web_app": {"url": self.mini_app_url},
            }})

    async def send(self, chat_id: int, text: str, *, with_app: bool = False) -> None:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if with_app and self.app_markup():
            payload["reply_markup"] = self.app_markup()
        await self.call("sendMessage", payload)

    async def handle_message(self, message: dict[str, Any]) -> None:
        chat = message.get("chat") or {}
        sender = message.get("from") or {}
        chat_id, user_id = chat.get("id"), sender.get("id")
        if not isinstance(chat_id, int) or not isinstance(user_id, int) or chat.get("type") != "private":
            return
        if not self.owner_id:
            await self.send(chat_id, f"Your Telegram user ID is {user_id}. Set TELEGRAM_OWNER_ID={user_id} in .env, then restart the Telegram service.")
            return
        if str(user_id) != self.owner_id:
            await self.send(chat_id, "This bot is private. Your Telegram account is not authorized.")
            return
        command = str(message.get("text") or "").split(maxsplit=1)[0].split("@", 1)[0].lower()
        if command == "/status":
            configured = self.mini_app_url.startswith("https://")
            await self.send(chat_id, "Nexa bot is connected. Mini App URL is " + ("ready." if configured else "missing or not HTTPS."), with_app=configured)
        elif command == "/help":
            await self.send(chat_id, "Use /app or the menu button to open the complete sales workspace inside Telegram.", with_app=True)
        else:
            await self.send(chat_id, "Nexa Sales AI is ready. Open the Mini App to use the complete workspace.", with_app=True)

    async def run(self) -> None:
        await self.call("deleteWebhook", {"drop_pending_updates": False})
        await self.setup()
        offset = 0
        log.info("Telegram bot polling started")
        while True:
            try:
                updates = await self.call("getUpdates", {
                    "offset": offset, "timeout": 30, "allowed_updates": ["message"],
                })
                for update in updates or []:
                    offset = max(offset, int(update["update_id"]) + 1)
                    if update.get("message"):
                        await self.handle_message(update["message"])
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("Telegram polling error: %s", exc)
                await asyncio.sleep(3)


async def main() -> None:
    configure_logging()
    settings = get_settings()
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is required for the telegram Docker profile.")
    bot = TelegramBot(settings.telegram_bot_token, settings.telegram_mini_app_url, settings.telegram_owner_id)
    try:
        await bot.run()
    finally:
        await bot.client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
