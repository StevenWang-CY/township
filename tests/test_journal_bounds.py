"""Payload bounds for the local capability-protected journal store."""

from starlette.testclient import TestClient

from backend.main import app
from backend.routes.journal import (
    JOURNAL_ID_MAX_CHARS,
    JOURNAL_MESSAGE_MAX_CHARS,
    JOURNAL_TRANSCRIPT_MAX_ITEMS,
)


def test_journal_rejects_unbounded_or_invalid_payloads():
    base = {"user_id": "bounded-user", "agent_id": "resident-1"}
    with TestClient(app) as client:
        assert client.post(
            "/api/journal/entry",
            json={
                **base,
                "transcript": [
                    {"role": "user", "content": "x" * (JOURNAL_MESSAGE_MAX_CHARS + 1)}
                ],
            },
        ).status_code == 422
        assert client.post(
            "/api/journal/entry",
            json={
                **base,
                "transcript": [
                    {"role": "system", "content": "not an allowed journal role"}
                ],
            },
        ).status_code == 422
        assert client.post(
            "/api/journal/entry",
            json={
                **base,
                "transcript": [
                    {"role": "user", "content": "bounded"}
                    for _ in range(JOURNAL_TRANSCRIPT_MAX_ITEMS + 1)
                ],
            },
        ).status_code == 422
        assert client.get(f"/api/journal/{'x' * (JOURNAL_ID_MAX_CHARS + 1)}").status_code == 422
        assert client.get("/api/journal/not%2Fa%2Fuser").status_code in {404, 422}
