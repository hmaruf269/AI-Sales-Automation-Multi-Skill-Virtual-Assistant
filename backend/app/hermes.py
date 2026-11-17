"""Client for the Hermes Agent API server Runs API (documented surface, pinned to v0.23.2).

Only these documented calls are used:
  GET  /health
  POST /v1/runs                    (with Idempotency-Key)
  GET  /v1/runs/{run_id}
  GET  /v1/runs/{run_id}/events    (SSE)
  POST /v1/runs/{run_id}/stop
"""
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
    def __init__(self, base_url: str, api_key: str, *, transport: httpx.BaseTransport | None = None,
                 poll_seconds: float = 2.0):
        self.base_url = base_url.rstrip("/")
        self.poll_seconds = poll_seconds
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(30.0, read=60.0),
            transport=transport,
        )

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def health(self) -> bool:
        if not self.configured:
            return False
        try:
            return self._http.get("/health", timeout=5.0).status_code == 200
        except httpx.HTTPError:
            return False

    def _raise_for(self, resp: httpx.Response) -> None:
        if resp.status_code < 400:
            return
        try:
            err = resp.json().get("error", {})
            message, code = (err.get("message"), err.get("code")) if isinstance(err, dict) else (str(err), "")
        except Exception:
            message, code = resp.text[:300], ""
        retry_after = None
        if resp.headers.get("Retry-After", "").isdigit():
            retry_after = float(resp.headers["Retry-After"])
        raise HermesError(
            f"Hermes returned HTTP {resp.status_code}: {message or 'no detail'}",
            retryable=resp.status_code in (429, 500, 502, 503, 504),
            retry_after=retry_after,
            code=code or str(resp.status_code),
        )

    def start_run(self, *, input: str, instructions: str, provider: str, model: str, idempotency_key: str) -> tuple[str, bool]:
        try:
            resp = self._http.post(
                "/v1/runs",
                json={"input": input, "instructions": instructions, "provider": provider, "model": model},
                headers={"Idempotency-Key": idempotency_key},
            )
        except httpx.HTTPError as exc:
            # Safe to retry: the same Idempotency-Key replays the original run instead of starting another.
            raise HermesError(f"Could not reach Hermes: {exc}", retryable=True, code="unreachable") from exc
        self._raise_for(resp)
        body = resp.json()
        return body["run_id"], resp.headers.get("Idempotency-Replayed", "").lower() == "true"

    def get_run(self, run_id: str) -> dict:
        try:
            resp = self._http.get(f"/v1/runs/{run_id}")
        except httpx.HTTPError as exc:
            raise HermesError(f"Could not reach Hermes: {exc}", retryable=True, code="unreachable") from exc
        self._raise_for(resp)
        return resp.json()

    def stop_run(self, run_id: str) -> None:
        try:
            self._http.post(f"/v1/runs/{run_id}/stop")
        except httpx.HTTPError:
            log.warning("stop request failed", extra={"hermes_run_id": run_id})

    def _consume_events(self, run_id: str, deadline: float, on_event, should_cancel, counts: dict) -> None:
        with self._http.stream("GET", f"/v1/runs/{run_id}/events") as resp:
            if resp.status_code != 200:
                raise HermesError("event stream unavailable", code="events")
            for line in resp.iter_lines():
                if time.monotonic() > deadline or (should_cancel and should_cancel()):
                    return
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except ValueError:
                    continue
                name = event.get("event", "")
                if name == "tool.completed" and event.get("tool"):
                    counts[event["tool"]] = counts.get(event["tool"], 0) + 1
                if on_event:
                    on_event(event)
                if name.startswith("run.") and name.split(".", 1)[1] in TERMINAL:
                    return

    def run(self, *, input: str, instructions: str, provider: str, model: str, idempotency_key: str,
            timeout: float, on_event: Optional[Callable[[dict], None]] = None,
            should_cancel: Optional[Callable[[], bool]] = None) -> RunResult:
        run_id, replayed = self.start_run(
            input=input, instructions=instructions, provider=provider, model=model, idempotency_key=idempotency_key)
        deadline = time.monotonic() + timeout
        counts: dict[str, int] = {}
        # A replayed run's early events are gone, so its tool counts cannot be trusted.
        counts_known = not replayed
        try:
            self._consume_events(run_id, deadline, on_event, should_cancel, counts)
        except (httpx.HTTPError, HermesError):
            counts_known = False

        while True:
            status = self.get_run(run_id)
            state = status.get("status", "")
            if state in TERMINAL:
                break
            if should_cancel and should_cancel():
                self.stop_run(run_id)
                raise HermesError("Run cancelled by owner.", code="cancelled")
            if state == "waiting_for_approval":
                # Hermes-side tool approvals are never granted automatically by this application.
                self.stop_run(run_id)
                raise HermesError("Hermes requested a tool approval, which this application does not grant.", code="approval")
            if time.monotonic() > deadline:
                self.stop_run(run_id)
                raise HermesError(f"Hermes run exceeded {int(timeout)}s and was stopped.", code="timeout")
            time.sleep(self.poll_seconds)

        runtime = status.get("runtime") or {}
        result = RunResult(
            run_id=run_id, status=state, output=status.get("output") or "", usage=status.get("usage") or {},
            served_provider=runtime.get("provider") or provider, served_model=runtime.get("model") or model,
            tool_calls=counts, tool_counts_known=counts_known, replayed=replayed,
        )
        if state != "completed":
            err = HermesError(status.get("error") or f"Hermes run ended with status '{state}'.", code=state)
            err.result = result  # usage is still billable and must be recorded by the caller
            raise err
        return result
