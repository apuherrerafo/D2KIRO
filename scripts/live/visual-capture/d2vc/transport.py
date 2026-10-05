"""Where envelopes go. Only allowlisted `draft-event/v1` JSON is ever serialized here -- never a frame.

Two targets, same envelope:
  * `LinkSender`  -- production/staging: POST /api/live/visual/<liveId> with the SAME link token the Dota GSI
                     cfg already carries (the session belongs to the link's account; the body cannot name one).
  * `LocalSender` -- a local engine: POST /ingest/draft-event with `x-capture-token`.
Failed sends stay queued and are retried (eventIds make a retry idempotent). Frames never reach this module.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections import deque
from typing import Protocol

from .emit import assert_allowlisted

MAX_QUEUE = 200
TIMEOUT_S = 4.0


class Sender(Protocol):
    def post(self, envelope: dict) -> bool: ...


def _post(url: str, headers: dict[str, str], body: dict) -> bool:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return 200 <= response.status < 300
    except urllib.error.HTTPError as error:
        return error.code in (400, 409, 410)  # the server answered and refused: retrying the same fact cannot help
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


class LinkSender:
    def __init__(self, base_url: str, live_id: str, token: str) -> None:
        self.url = f"{base_url.rstrip('/')}/api/live/visual/{live_id}"
        self._token = token

    def post(self, envelope: dict) -> bool:
        assert_allowlisted(envelope)
        return _post(self.url, {}, {"auth": {"token": self._token}, "envelope": envelope})


class LocalSender:
    def __init__(self, engine_url: str, capture_token: str) -> None:
        self.url = f"{engine_url.rstrip('/')}/ingest/draft-event"
        self._token = capture_token

    def post(self, envelope: dict) -> bool:
        assert_allowlisted(envelope)
        return _post(self.url, {"x-capture-token": self._token}, envelope)


class Outbox:
    """Ordered, bounded retry queue in front of a Sender."""

    def __init__(self, sender: Sender) -> None:
        self.sender = sender
        self.pending: deque[dict] = deque()

    def submit(self, envelopes: list[dict]) -> None:
        for envelope in envelopes:
            if len(self.pending) >= MAX_QUEUE:
                self.pending.popleft()  # oldest first; health heartbeats are the usual casualty
            self.pending.append(envelope)
        self.flush()

    def flush(self) -> None:
        while self.pending:
            if not self.sender.post(self.pending[0]):
                return
            self.pending.popleft()
