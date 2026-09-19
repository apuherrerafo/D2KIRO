# Wave 1 / Task 11 — Collision #3 authority (Product Owner decision: Option A)

## Rule (PD-022, V1)
Collision event #3 in a pick round is won by whoever the `ProtocolSessionStore` **actually accepted first**. Lower registration
ordinal wins; the loser reopens and repicks. No PRNG, no seed, no hash tie-break, no synthetic reaction time.

## Where the evidence lives
The kernel canonicalizes arrival order on purpose (S1 frozen contract) and that is untouched. The ordering is kept in a
**registration ledger inside `ProtocolSessionStore`** (`server/protocol-session.ts`, per-session `registrations[]`), outside
`DraftProtocolState`. It is never fed back to the kernel and is part of no replay/state hash.

* Ordinal assigned: in `apply()` / `applyAtomically()`, immediately after the kernel **accepted** a `SUBMIT_SEALED_SELECTION`.
  Rejected commands never reach the ledger. Integer sequence per session, starting at 1.
* Attempt isolation: each record stores `round` and `collisionsResolved` of the state it was accepted against. Collision #1/#2
  reopen seats and bump `collisionsResolved`, so the selections for collision #3 are exactly the records of
  `(pending.round, current collisionsResolved)` for the two contenders and the disputed hero. Other attempts/rounds are ignored.
* `resolveSimulatorCollisionAuthority(pending, evidence)` requires that evidence. Exactly one matching record per contender and
  distinct ordinals, otherwise it returns `{ ok: false, reason: REGISTRATION_EVIDENCE_MISSING | _AMBIGUOUS }` and the routes
  answer `409 collision_authority_unavailable`, leaving the draft paused in `WAITING_FOR_COLLISION_AUTHORITY`.

## Known simulator-pacing limitation (accepted for V1, NOT an authority defect)
The Enemy Bot seals before the Player is prompted, so in the normal flow the bot registers first and therefore wins a third
collision. Bot pacing / simulated human reaction time is a separate product problem, deliberately not addressed here.

## Product-Owner-approved V1 simulator approximation — repick timer
Public documentation confirms that the loser of the third collision receives additional time to repick, but the exact duration is
not established by the evidence available to us. For V1 the Simulator **restarts the applicable round base timer** (25 s in rounds
1–2, 20 s in round 3) for every repick after a collision. This is a PRODUCT-OWNER-APPROVED V1 SIMULATOR APPROXIMATION, not a claim
about Valve's hidden duration.
