# Telegram Mini App setup

The existing Next.js workspace runs unchanged in a Telegram webview. Telegram authenticates the single owner; FastAPI validates signed `initData` before issuing the same HttpOnly session cookie used by browser login.

## 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) and run `/newbot`.
2. Copy the bot token into the root `.env` file as `TELEGRAM_BOT_TOKEN`.
3. Do not paste the token into chat, frontend code, or a committed file.

## 2. Give the app a public HTTPS URL

Telegram mobile clients cannot open `localhost` on the development computer. Publish the frontend behind an HTTPS domain or use a temporary HTTPS tunnel that points to `http://localhost:3000`.

Set these values in `.env`:

```dotenv
PUBLIC_BASE_URL=https://your-public-host.example
COOKIE_SECURE=true
TELEGRAM_BOT_TOKEN=123456:replace-with-the-botfather-token
TELEGRAM_OWNER_ID=
TELEGRAM_MINI_APP_URL=https://your-public-host.example
```

`PUBLIC_BASE_URL` and `TELEGRAM_MINI_APP_URL` should use the same origin so the existing same-origin API proxy and session cookie continue to work.

## 3. Discover and lock the owner ID

Start the optional bot service:

```powershell
docker compose --profile telegram up -d --build
```

Send `/start` to the new bot. With `TELEGRAM_OWNER_ID` blank, it replies with the numeric ID to configure. Put that value in `.env`, then recreate the backend and bot:

```powershell
docker compose --profile telegram up -d --build --force-recreate backend telegram-bot
```

Only that Telegram account can authenticate. Other users receive an authorization error even if they know the Mini App URL.

## 4. Open the app

Send `/app` to the bot or use its **Open Nexa** menu button. The bot configures this menu automatically whenever it starts with an HTTPS `TELEGRAM_MINI_APP_URL`.

Useful checks:

```powershell
docker compose --profile telegram ps
docker compose logs -f telegram-bot backend frontend
```

Browser login remains available at the public URL and at `http://localhost:3000` for local desktop use.

## Security behavior

- The bot token remains in backend and bot containers only.
- FastAPI verifies Telegram's HMAC-SHA-256 signature and rejects expired `initData`.
- The configured numeric owner ID is checked after signature validation.
- The resulting session uses a `Secure`, `HttpOnly`, `SameSite=None` cookie and CSRF protection so Telegram's native webviews and web client can both authenticate.
- Framing is restricted by CSP to the app itself and Telegram web origins.
- Email sending and publishing still require the application's existing approval flow.
