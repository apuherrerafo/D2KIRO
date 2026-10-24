# Checkpoints

A checkpoint freezes one exam run as a reproducible reference: the commit, the data snapshot, the configuration, the seeds and the result hashes.
`F1.json` is the first. Its status is **F1 TECHNICAL REFERENCE, NO STRATEGIC CERTIFICATION**: the technical invariants of the exam hold; whether the advice wins games was not certified.

Verify (cheap, no drafts are run):

    bun scripts/p1-exam/checkpoint.ts --verify --id=F1 --tag=checkpoint/f1-v1

It checks the result and data hashes, that the manifest still agrees with the exam's own identity, that nothing but documentation and this tooling changed after the measured commit, and that the tag adds only `docs/checkpoints/`.
The full reproduction (re-running the 120 drafts) is on demand: check out the tag in a worktree, run the command in `exam.reproduce`, and compare with `compareIdentities` (`scripts/wave5/evidence-identity.ts`). It is not part of this verification.

The blind A/B key is not in the repository and is never read by this tooling; the manifest holds only a salted commitment. It is revealed together with its salt after the judge has answered.

## Rule for the future comparison lab (F1, F1+F2, F1+F2+F3, F1+F2+F3+F4)

**The primary unit of comparison is the same pick moment, not just the same draft.**

Every version must receive exactly the same decision state:

- allies and their positions
- visible rivals
- bans
- the evaluated position
- Hero Pool
- perspective
- data snapshot

Information from future picks is never used.

A full autonomous draft is a **secondary** test: decisions differ between versions, so the paths diverge and the later states are no longer the same question.
