"""Typed client for the official Hermes Agent v0.23.2 API-server surface.

Only documented HTTP interfaces are used. No private Hermes Python modules are imported.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import httpx

log = logging.getLogger("hermes")
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


class HermesError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, retry_after: float | None = None, code: str = ""):
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after
        self.code = code


@dataclass
class RunResult:
    run_id: str
    status: str
    output: str
    usage: dict
    served_provider: str
    served_model: str
    tool_calls: dict[str, int] = field(default_factory=dict)
    tool_counts_known: bool = True
    replayed: bool = False


class HermesClient:
    def __init__(self, base_url: str, api_key: str, *, transport: httpx.BaseTransport | None = None, poll_seconds: float = 2.0):
        self.base_url = base_url.rstrip("/")
        self.poll_seconds = poll_seconds
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._http = httpx.Client(
            base_url=self.base_url or "http://hermes-not-configured.invalid",
            headers=headers,
            timeout=httpx.Timeout(30.0, read=60.0),
            transport=transport,
        )

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def close(self) -> None:
        self._http.close()

    def _raise_for(self, resp: httpx.Response) -> None:
        if resp.status_code < 400:
            return
        message, code = "", ""
        try:
            body = resp.json()
            err = body.get("error", body.get("detail", body)) if isinstance(body, dict) else body
            if isinstance(err, dict):
                message = str(err.get("message") or err.get("detail") or "")
                code = str(err.get("code") or body.get("code") or "")
            else:
                message = str(err)
        except Exception:
            message = resp.text[:500]
        retry_after = None
        value = resp.headers.get("Retry-After", "")
        try:
            retry_after = float(value) if value else None
        except ValueError:
            pass
        raise HermesError(
            f"Hermes returned HTTP {resp.status_code}: {message or 'no detail'}",
            retryable=resp.status_code in {429, 500, 502, 503, 504},
            retry_after=retry_after,
            code=code or str(resp.status_code),
        )

    def _get_json(self, path: str, *, params: dict | None = None, timeout: float | None = None):
        if not self.configured:
            raise HermesError("Hermes is not configured.", code="not_configured")
        try:
            resp = self._http.get(path, params=params, timeout=timeout)
        except httpx.HTTPError as exc:
            raise HermesError(f"Could not reach Hermes: {exc}", retryable=True, code="unreachable") from exc
        self._raise_for(resp)
        return resp.json()

    def health(self) -> bool:
        if not self.configured:
            return False
        try:
            body = self._get_json("/health", timeout=5.0)
            return body.get("status") == "ok"
        except (HermesError, ValueError):
            return False

    def readiness(self) -> dict:
        return self._get_json("/health/detailed", timeout=10.0)

    def capabilities(self) -> dict:
        body = self._get_json("/v1/capabilities", timeout=10.0)
        if body.get("platform") != "hermes-agent":
            raise HermesError("The configured endpoint is not a Hermes Agent API server.", code="wrong_platform")
        required = {"run_submission", "run_status", "run_events_sse", "run_stop"}
        missing = sorted(k for k in required if not (body.get("features") or {}).get(k))
        if missing:
            raise HermesError(f"Hermes is missing required Runs API capabilities: {', '.join(missing)}", code="unsupported")
        return body

    def model_options(self, *, refresh: bool = False):
        return self._get_json("/api/model/options", params={"refresh": 1} if refresh else None, timeout=30.0)

    def skills(self):
        return self._get_json("/v1/skills", timeout=15.0)

    def toolsets(self):
        return self._get_json("/v1/toolsets", timeout=15.0)

    def start_run(self, *, input: str, instructions: str, provider: str, model: str,
                  idempotency_key: str, session_id: str | None = None,
                  session_key: str | None = None) -> tuple[str, bool]:
        if not self.configured:
            raise HermesError("Hermes is not configured.", code="not_configured")
        payload = {"input": input, "instructions": instructions, "provider": provider, "model": model}
        if session_id:
            payload["session_id"] = session_id
        headers = {"Idempotency-Key": idempotency_key}
        if session_key:
            headers["X-Hermes-Session-Key"] = session_key
        try:
            resp = self._http.post("/v1/runs", json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise HermesError(f"Could not reach Hermes: {exc}", retryable=True, code="unreachable") from exc
        self._raise_for(resp)
        body = resp.json()
        run_id = body.get("run_id")
        if not run_id:
            raise HermesError("Hermes did not return a run_id.", code="invalid_response")
        return str(run_id), resp.headers.get("Idempotency-Replayed", "").lower() == "true"

    def get_run(self, run_id: str) -> dict:
        return self._get_json(f"/v1/runs/{run_id}")

    def stop_run(self, run_id: str) -> dict:
        try:
            resp = self._http.post(f"/v1/runs/{run_id}/stop")
            self._raise_for(resp)
            return resp.json()
        except httpx.HTTPError as exc:
            raise HermesError(f"Could not stop Hermes run: {exc}", retryable=True, code="unreachable") from exc

    def _consume_events(self, run_id: str, deadline: float, on_event, should_cancel, counts: dict) -> None:
        try:
            with self._http.stream("GET", f"/v1/runs/{run_id}/events") as resp:
                self._raise_for(resp)
                event_name = "message"
                data_lines: list[str] = []

                def emit() -> bool:
                    nonlocal data_lines
                    if not data_lines:
                        return False
                    raw = "\n".join(data_lines); data_lines = []
                    try:
                        payload = json.loads(raw)
                    except ValueError:
                        payload = {"text": raw}
                    if not isinstance(payload, dict):
                        payload = {"data": payload}
                    payload.setdefault("event", event_name)
                    name = str(payload.get("event") or event_name)
                    if name == "tool.completed" and payload.get("tool"):
                        tool = str(payload["tool"])
                        counts[tool] = counts.get(tool, 0) + 1
                    if on_event:
                        on_event(payload)
                    return name.startswith("run.") and name.split(".", 1)[1] in TERMINAL

                for line in resp.iter_lines():
                    if time.monotonic() > deadline:
                        return
                    if should_cancel and should_cancel():
                        self.stop_run(run_id)
                        return
                    if line.startswith(":"):
                        continue
                    if not line:
                        if emit():
                            return
                        event_name = "message"
                    elif line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
                emit()
        except httpx.HTTPError as exc:
            raise HermesError(f"Hermes event stream failed: {exc}", retryable=True, code="events") from exc

    def run(self, *, input: str, instructions: str, provider: str, model: str, idempotency_key: str,
            timeout: float, on_event: Optional[Callable[[dict], None]] = None,
            should_cancel: Optional[Callable[[], bool]] = None) -> RunResult:
        run_id, replayed = self.start_run(input=input, instructions=instructions, provider=provider, model=model,
                                          idempotency_key=idempotency_key)
        deadline = time.monotonic() + timeout
        counts: dict[str, int] = {}
        counts_known = not replayed
        # SSE is best-effort. Polling remains authoritative after disconnects.
        try:
            self._consume_events(run_id, deadline, on_event, should_cancel, counts)
        except HermesError:
            counts_known = False

        while True:
            status = self.get_run(run_id)
            state = str(status.get("status") or "")
            if state in TERMINAL:
                break
            if state == "unknown":
                raise HermesError("Hermes restarted while execution was in flight; manual unknown-run resolution is required.", code="unknown_execution")
            if state == "waiting_for_approval":
                raise HermesError("Hermes is waiting for a human tool approval. Review it in the Hermes control surface.", code="approval_required")
            if should_cancel and should_cancel():
                self.stop_run(run_id)
                raise HermesError("Run cancelled by owner.", code="cancelled")
            if time.monotonic() > deadline:
                self.stop_run(run_id)
                raise HermesError(f"Hermes run exceeded {int(timeout)}s and was stopped.", code="timeout")
            time.sleep(self.poll_seconds)

        runtime = status.get("runtime") or {}
        result = RunResult(
            run_id=run_id,
            status=state,
            output=str(status.get("output") or ""),
            usage=status.get("usage") or {},
            served_provider=str(runtime.get("provider") or provider),
            served_model=str(runtime.get("model") or model),
            tool_calls=counts,
            tool_counts_known=counts_known,
            replayed=replayed,
        )
        if state != "completed":
            error = HermesError(str(status.get("error") or f"Hermes run ended with status '{state}'."), code=state)
            error.result = result
            raise error
        return result