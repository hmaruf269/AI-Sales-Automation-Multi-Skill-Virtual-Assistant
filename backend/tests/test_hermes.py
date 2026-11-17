import json

import httpx

from app.hermes import HermesClient


def test_capabilities_and_completed_run_with_sse_events():
    seen = {"idempotency": None, "payload": None}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/capabilities":
            return httpx.Response(200, json={
                "object": "hermes.api_server.capabilities", "platform": "hermes-agent",
                "features": {"run_submission": True, "run_status": True, "run_events_sse": True, "run_stop": True},
            })
        if request.url.path == "/v1/runs" and request.method == "POST":
            seen["idempotency"] = request.headers.get("Idempotency-Key")
            seen["payload"] = json.loads(request.content)
            return httpx.Response(202, json={"run_id": "run_1", "status": "started"})
        if request.url.path == "/v1/runs/run_1/events":
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=(
                "event: tool.started\ndata: {\"tool\":\"web_search\"}\n\n"
                "event: tool.completed\ndata: {\"tool\":\"web_search\",\"duration\":1.2,\"error\":false}\n\n"
                "event: run.completed\ndata: {\"status\":\"completed\"}\n\n"
            ))
        if request.url.path == "/v1/runs/run_1":
            return httpx.Response(200, json={
                "run_id": "run_1", "status": "completed", "output": "Done",
                "usage": {"input_tokens": 10, "output_tokens": 3},
                "runtime": {"provider": "openai-api", "model": "configured-model"},
            })
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    events = []
    client = HermesClient("http://hermes", "secret", transport=httpx.MockTransport(handler), poll_seconds=0)
    assert client.capabilities()["platform"] == "hermes-agent"
    result = client.run(
        input="research", instructions="safe", provider="openai-api", model="configured-model",
        idempotency_key="workflow:1", timeout=5, on_event=events.append,
    )
    assert seen["idempotency"] == "workflow:1"
    assert seen["payload"]["provider"] == "openai-api"
    assert result.output == "Done"
    assert result.tool_calls == {"web_search": 1}
    assert [event["event"] for event in events] == ["tool.started", "tool.completed", "run.completed"]


def test_health_requires_ok_status():
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"status": "degraded"}))
    assert HermesClient("http://hermes", "secret", transport=transport).health() is False
