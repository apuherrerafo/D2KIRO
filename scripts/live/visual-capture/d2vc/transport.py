"""Where envelopes go. Only allowlisted `draft-event/v1` JSON is ever serialized here -- never a frame.

Two targets, same envelope:
  * `LinkSender`  -- production/staging: POST /api/live/visual/<liveId> with the SAME link token the Dota GSI
                     cfg already carries (the session belongs to the link's account; the body cannot name one).
  * `LocalSender` -- a local engine: POST /ingest/draft-event with `x-capture-token`.
Failed sends stay queued and are retried (eventIds make a retry idempotent). Frames never reach this module.

Each accepted POST answers with the draft lifecycle GSI decided server side (`live-visual-ack/v1`: phase + a
draft counter). The helper never sees GSI itself; this is how it knows a new hero-selection screen began.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass
from typing import Protocol

from .emit import assert_allowlisted

MAX_QUEUE = 200
TIMEOUT_S = 4.0


DRAFT_PHASES = {"waiting", "hero_selection", "ended"}
MAX_ACK_BYTES = 1024


@dataclass(frozen=True)
class DraftLifecycle:
    """The server's word on the draft: `phase` from GSI, `epoch` = drafts started on this live session."""

    phase: str
    epoch: int

    @property
    def drafting(self) -> bool:
        return self.phase == "hero_selection"


def lifecycle_of(body: object) -> DraftLifecycle | None:
    """`live-visual-ack/v1` (top level from the link relay, under "ack" from a local engine), or None."""
    if isinstance(body, dict) and isinstance(body.get("ack"), dict):
        body = body["ack"]
    if not isinstance(body, dict) or body.get("schema") != "live-visual-ack/v1":
        return None
    phase, epoch = body.get("draftPhase"), body.get("draftEpoch")
    if phase not in DRAFT_PHASES or not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0:
        return None
    return DraftLifecycle(phase, epoch)


class Sender(Protocol):
    def post(self, envelope: dict) -> bool: ...


def _post(url: str, headers: dict[str, str], body: dict) -> tuple[bool, DraftLifecycle | None]:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            if not 200 <= response.status < 300:
                return False, None
            try:
                answer = json.loads(response.read(MAX_ACK_BYTES) or b"null")
            except ValueError:
                answer = None
            return True, lifecycle_of(answer)
    except urllib.error.HTTPError as error:
        return error.code in (400, 409, 410), None  # the server answered and refused: retrying the same fact cannot help
    except (urllib.error.URLError, TimeoutError, OSError):
        return False, None


class LinkSender:
    def __init__(self, base_url: str, live_id: str, token: str) -> None:
        self.url = f"{base_url.rstrip('/')}/api/live/visual/{live_id}"
        self._token = token
        self.lifecycle: DraftLifecycle | None = None

    def post(self, envelope: dict) -> bool:
        assert_allowlisted(envelope)
        delivered, lifecycle = _post(self.url, {}, {"auth": {"token": self._token}, "envelope": envelope})
        self.lifecycle = lifecycle or self.lifecycle
        return delivered


class LocalSender:
    def __init__(self, engine_url: str, capture_token: str) -> None:
        self.url = f"{engine_url.rstrip('/')}/ingest/draft-event"
        self._token = capture_token
        self.lifecycle: DraftLifecycle | None = None

    def post(self, envelope: dict) -> bool:
        assert_allowlisted(envelope)
        delivered, lifecycle = _post(self.url, {"x-capture-token": self._token}, envelope)
        self.lifecycle = lifecycle or self.lifecycle
        return delivered


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

    @property
    def lifecycle(self) -> DraftLifecycle | None:
        """Last draft lifecycle the server answered (None until it has answered one)."""
        return getattr(self.sender, "lifecycle", None)

    def discard_facts(self) -> None:
        """A draft boundary: a pick/ban still queued belongs to the draft that just ended. Health stays."""
        self.pending = deque(e for e in self.pending if e["payload"]["type"] == "capture_health")

    def flush(self) -> None:
        while self.pending:
            if not self.sender.post(self.pending[0]):
                return
            self.pending.popleft()
