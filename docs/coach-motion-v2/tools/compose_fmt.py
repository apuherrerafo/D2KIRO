"""Stacks the lab screenshots into format-comparison-{dark,light}.png: LIVE | A | B | C at the actual Hero coach size (DPR 2) and a 2x inspection row."""
import json, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, __file__.replace("\\", "/").rsplit("/", 1)[0])
from lib_p2 import S, OUT
FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
SMALL = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 17)
TITLES = {"panel-live": "LIVE (Three.js)", "panel-a": "A · 384 px · 30 fps · AVIF q45", "panel-b": "B · 384 px · 24 fps · AVIF q30", "panel-c": "C · 256 px · 30 fps · AVIF q40"}
for theme in ("dark", "light"):
    rows = []
    for tag, dpr, shot, label in (("actual", 2, "idle", "actual size, DPR 2 (device px 1:1) · WATCHING idle"), ("actual", 2, "mid", "actual size, DPR 2 · +330 ms into WATCHING → ANALYZING"), ("inspect", 1, "mid", "2× inspection of the displayed pixels (DPR 1, nearest-neighbour) · +330 ms")):
        rects = json.load(open(f"{S}/shots/rects-{theme}-{tag}.json"))
        im = Image.open(f"{S}/shots/shot-{theme}-{tag}-{shot}.png").convert("RGB")
        crops = []
        for pid in TITLES:
            r = rects[pid]
            x, y = int(r["x"] * dpr), int(r["y"] * dpr)
            w = int(r["width"] * dpr)
            crops.append(im.crop((x, y + int(60 * (1 if tag == "inspect" else 1)), x + w, y + int(w * 350 / 276) - 20)))
        rows.append((label, crops))
    cw, ch = rows[0][1][0].size
    pad, head = 14, 34
    W = 4 * cw + 5 * pad
    H = sum(head + ch + pad for _ in rows) + 46
    bg = (20, 18, 16) if theme == "dark" else (238, 238, 234)
    fg = (230, 230, 230) if theme == "dark" else (30, 30, 30)
    out = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(out)
    y = 8
    d.text((pad, y), "Coach Motion V2 · production format shootout · " + theme + " theme", fill=fg, font=FONT)
    y = 46
    for label, crops in rows:
        d.text((pad, y + 6), label, fill=fg, font=SMALL)
        y += head
        for i, c in enumerate(crops):
            out.paste(c, (pad + i * (cw + pad), y))
            d.text((pad + i * (cw + pad) + 8, y + 6), list(TITLES.values())[i], fill=(255, 210, 90), font=SMALL)
        y += ch + pad
    out.save(f"{OUT}/format-comparison-{theme}.png", optimize=True)
    print(theme, out.size)
