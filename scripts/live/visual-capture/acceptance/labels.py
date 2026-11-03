"""Eye-derived labels of the saved REAL 1600x900 corpus (Spanish UI). Independent of any gate under test.

Sessions (frames `<session>-<nnn>-raw.png`, `save-frames.flag` captures):
  5cac470b  BOT_A   bot lobby (frames 1-17) + a human-lobby epoch (22-29)
  ed6ae5ff  BOT_B   bot lobby
  65964acb  HUMAN   human lobby (rank banner + medal on every card)
  824903f3  0.1.2 live run: bot epoch (frames 1-10) then the human draft (13-29)

Cell classes (one cell = one pick card on one frame):
  E empty / unlocked, no hover (incl. human cards with their rank banner)    G ghost / hover (own or teammate)
  L locked pick                                                              O '-2 gold' overlay on a non-locked card
  N non-draft frame (menu / black / partial)                                 T first frame of a state change (excluded)

Which locked card shows which hero is in `truth.json` (read off the frames by eye, checked against the portraits).
40 locked cards in all: 39 with L cells (366 cell-frames) + Witch Doctor on 5cac470b d4, which locks on the last saved
frame (label T). The d0 card of the 0.1.2 human draft is NOT in the corpus (its late pixels were never saved).
"""
from __future__ import annotations

SLOTS = [f"{side}{i}" for side in "rd" for i in range(5)]
SESSION_FRAMES = {"824903f3": range(0, 30), "65964acb": range(0, 30), "5cac470b": range(0, 30), "ed6ae5ff": range(0, 16)}

# Draft epochs the replay feeds through a VisualSession: (session, kind, frames). Each starts on an empty bar.
EPOCHS = [
    ("824903f3", "bot", [n for n in range(1, 11)]),
    ("824903f3", "human", [n for n in range(13, 30)]),
    ("65964acb", "human", [n for n in range(0, 30)]),
    ("5cac470b", "bot", [n for n in range(1, 18)]),
    ("5cac470b", "human", [n for n in range(22, 30)]),
    ("ed6ae5ff", "bot", [n for n in range(1, 16) if n != 11]),
]


def kind(session: str, frame: int) -> str:
    if session == "824903f3":
        return "bot" if frame <= 10 else "human"
    if session == "5cac470b":
        return "bot" if frame <= 17 else "human"
    return "bot" if session == "ed6ae5ff" else "human"


def label(session: str, frame: int, slot: str) -> str:
    if session == "824903f3":
        if frame in (11, 12):
            return "N"
        if frame <= 10:  # bot epoch
            if frame == 0:
                return "N"
            if frame == 1:
                return "E"
            if frame in (2, 3, 4):
                return "G" if slot == "r0" else "E"
            return "L"  # 5..10 all locked bot cards (10 is Strategy Time)
        spans = {"r0": [(24, 29, "G")], "r2": [(14, 29, "G")], "r3": [(24, 24, "G"), (25, 29, "L")], "r4": [(17, 17, "G"), (18, 29, "L")], "d1": [(25, 29, "L")], "d2": [(25, 29, "L")]}
    elif session == "65964acb":
        spans = {
            "r1": [(18, 29, "L")],
            "r3": [(18, 29, "L")],
            "d0": [(12, 12, "O"), (13, 29, "L")],
            "d1": [(1, 11, "G"), (12, 14, "O"), (15, 17, "G"), (18, 29, "L")],
            "d2": [(10, 11, "G"), (12, 14, "O"), (15, 29, "G")],
            "d3": [(9, 11, "G"), (12, 14, "O"), (15, 23, "G"), (24, 29, "L")],
            "d4": [(12, 14, "O")],
        }
    elif session == "5cac470b":
        if frame in (0, 18, 19, 20, 21):
            return "N"
        if frame <= 17:
            return "E" if frame <= 7 else "L"
        spans = {"d1": [(26, 29, "G")], "d2": [(29, 29, "T")], "d4": [(29, 29, "T")]}
    elif session == "ed6ae5ff":
        if frame in (0, 11):
            return "N"
        if frame == 1:
            return "E"
        if frame == 2:
            return "G" if slot == "r0" else "E"
        return "L"
    else:
        raise KeyError(session)
    for start, end, cls in spans.get(slot, []):
        if start <= frame <= end:
            return cls
    return "E"
