"""Confirmed visual events -> `draft-event/v1` envelopes (source "ocr"). ONLY derived facts leave the process.

Allowlist: hero id, side, ban/pick, confidence, health code. Never pixels, text, names or account ids.
`assert_allowlisted` runs on every envelope before it can be sent.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Callable

from .stability import VisualEvent

SCHEMA = "draft-event/v1"
ALLOWED_ENVELOPE_KEYS = {"schema", "eventId", "sessionId", "seq", "emittedAt", "source", "confidence", "payload"}
ALLOWED_PAYLOADS: dict[str, set[str]] = {
    "hero_picked": {"type", "hero", "side"},
    "pick_reverted": {"type", "hero", "side"},
    "hero_banned": {"type", "hero", "side"},
    "capture_health": {"type", "status", "detail"},
}
HEALTH_DETAILS = {"VISUAL_OK", "VISUAL_NO_WINDOW", "VISUAL_NO_HERO_SELECTION", "VISUAL_CAPTURE_LOST", "VISUAL_LAYOUT_UNVERIFIED"}


class PrivacyViolation(Exception):
    """An envelope tried to carry something outside the allowlist."""


def assert_allowlisted(envelope: dict) -> None:
    if set(envelope) - ALLOWED_ENVELOPE_KEYS:
        raise PrivacyViolation("envelope key outside allowlist")
    payload = envelope.get("payload")
    if not isinstance(payload, dict) or payload.get("type") not in ALLOWED_PAYLOADS:
        raise PrivacyViolation("payload type outside allowlist")
    if set(payload) - ALLOWED_PAYLOADS[payload["type"]]:
        raise PrivacyViolation("payload field outside allowlist")
    for value in list(envelope.values()) + list(payload.values()):
        if isinstance(value, (bytes, bytearray)) or not isinstance(value, (str, int, float, dict)):
            raise PrivacyViolation("non-scalar value")
    if envelope.get("source") != "ocr":
        raise PrivacyViolation("visual capture always declares source 'ocr'")
    detail = payload.get("detail")
    if detail is not None and detail not in HEALTH_DETAILS:
        raise PrivacyViolation("free-text detail is not allowed")
    if "hero" in payload and not (isinstance(payload["hero"], int) and 0 < payload["hero"] < 1000):
        raise PrivacyViolation("hero must be a small positive int")


@dataclass
class EnvelopeFactory:
    session_id: str
    run_id: str
    clock: Callable[[], dt.datetime]
    seq: int = 0

    def _wrap(self, payload: dict, confidence: float, tag: str) -> dict:
        self.seq += 1
        now = self.clock().astimezone(dt.timezone.utc)
        envelope = {
            "schema": SCHEMA,
            "eventId": f"ocr-{self.run_id}-{self.seq}-{tag}",
            "sessionId": self.session_id,
            "seq": self.seq,
            "emittedAt": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
            "source": "ocr",
            "confidence": max(0.0, min(1.0, float(confidence))),
            "payload": payload,
        }
        assert_allowlisted(envelope)
        return envelope

    def from_event(self, event: VisualEvent) -> dict:
        if event.kind == "ban":
            return self._wrap({"type": "hero_banned", "hero": event.hero_id, "side": "unknown"}, event.confidence, f"ban{event.hero_id}")
        kind = "hero_picked" if event.kind == "pick" else "pick_reverted"
        return self._wrap({"type": kind, "hero": event.hero_id, "side": event.side}, event.confidence, f"{event.kind}{event.hero_id}")

    def health(self, status: str, detail: str) -> dict:
        return self._wrap({"type": "capture_health", "status": status, "detail": detail}, 1.0, "health")
