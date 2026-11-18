# Hermes Agent integration

The application uses the official Nous Research Hermes Agent Runs API. It does not import private Hermes Python modules.
The Docker build is pinned to the official `v0.23.2` source tag.

## Architecture

1. Next.js calls the same-origin FastAPI proxy.
2. FastAPI persists a `WorkflowRun` and queues its ID through Celery.
3. The worker applies application policy, approved business knowledge, budgets, and prompt-injection boundaries.
4. The worker calls Hermes `POST /v1/runs` with an idempotency key and explicit provider/model.
5. Tool and lifecycle events from `/v1/runs/{id}/events` are persisted for dashboard progress.
6. Polling `/v1/runs/{id}` is authoritative after an SSE disconnect.
7. Model output is saved as a suggestion. It never directly sends email, publishes, invites attendees, or mutates the CRM.

## First-time setup

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Generate a Fernet key:

   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

3. Build the pinned Hermes image and create its data volume:

   ```bash
   docker compose build hermes
   docker compose run --rm hermes setup
   ```

4. In the Hermes setup wizard, configure the desired OpenAI and/or Kimi provider credentials and web tools.
5. For the free Gemini option, create a key in Google AI Studio and set `GEMINI_API_KEY` plus `GEMINI_CONFIGURED=true` in `.env`. Hermes receives that key as `GEMINI_API_KEY` / `GOOGLE_API_KEY` and the app calls provider `gemini`. The app automatically adds `gemini-3.5-flash-lite` and uses it as the default route when no default route exists. Override the model with `GEMINI_DEFAULT_MODEL` if Google's catalog changes.
6. Set `OPENAI_CONFIGURED=true` and/or `KIMI_CONFIGURED=true` in `.env` only after those paid providers are configured inside Hermes.
7. Start the stack:

   ```bash
   docker compose up -d --build
   ```

8. Check readiness:

   ```bash
   curl http://localhost:8642/health
   curl -H "Authorization: Bearer $HERMES_API_SERVER_KEY" http://localhost:8642/v1/capabilities
   curl http://localhost:8000/health
   ```

## Configure models

Hermes provider/model IDs and prices are configuration data, not source-code constants.

1. Sign in to the application.
2. Read Hermes' provider-aware catalog through `GET /api/agent/model-options`.
3. Add chosen models with `POST /api/models`.
4. Map workflow types with `PUT /api/settings/model-routing`.

When an application budget is active, a model without owner-maintained pricing is rejected because its cost cannot be enforced.
Estimates are explicitly separate from provider invoices.

## Security notes

- Keep port 8642 bound to loopback or a private container network. Hermes can use powerful tools.
- Only FastAPI stores the Hermes bearer token; it is never returned to the browser.
- External webpages, messages, and documents must be marked untrusted before model use.
- Hermes tool approvals remain human decisions. The application never auto-approves a Hermes tool request.
- Back up the `hermes_data`, `postgres_data`, and `uploads` volumes together.

## What Hermes provides

- Agent reasoning and tool execution.
- Web/tool progress events.
- Per-request provider and model selection.
- Idempotent durable run admission, polling, cancellation, sessions, skills, toolsets, and scheduled jobs.

## What the application provides

- Owner authentication, CRM and business data.
- Workflow policy, approvals, suppression, and external-action authorization.
- Model routing, fallback, bounded retries, budgets, and cost estimates.
- Durable UI-facing workflow records and recovery messages.
