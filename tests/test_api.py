import json

from fastapi.testclient import TestClient

import api


def test_stream_sends_progress_then_the_outcome(monkeypatch):
    async def fake_discover(question, seeds, *, limit, emit):
        emit("stage", stage="resolve", status="start")
        emit("channel", channel="similar", name="PubMed similar articles", found=12)
        raise ValueError("none of the seeds could be found in PubMed or Europe PMC")

    monkeypatch.setenv("NEBIUS_API_KEY", "test")
    monkeypatch.setattr(api, "discover", fake_discover)
    with TestClient(api.app).stream("POST", "/discover/stream", json={"question": "Which drugs?", "seeds": ["1"]}) as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = [block.split("\n") for block in resp.read().decode().strip().split("\n\n")]
    parsed = [(lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))) for lines in events]
    assert [name for name, _ in parsed] == ["stage", "channel", "error"]
    assert parsed[2][1] == {"status": 422, "detail": "none of the seeds could be found in PubMed or Europe PMC"}
