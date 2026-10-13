"""Shared helpers for the production-format study (analyze_fmt.py / analyze_cont.py). Pure numpy + cv2 + PIL."""
import glob, json, os
import numpy as np, cv2
from PIL import Image

S = os.environ.get("CM_P2_DIR", "p2")   # scratch dir with the captured study frames (not committed; set CM_P2_DIR)
WT = "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration"
OUT = WT + "/docs/coach-motion-v2/production-format"
BG = {"dark": (32.0, 29.0, 27.0), "light": (250.0, 251.0, 248.0)}   # lab stage backgrounds (computed style of .cm-stage)
os.makedirs(OUT, exist_ok=True)


def load(d):
    return [np.array(Image.open(f).convert("RGBA")) for f in sorted(glob.glob(d + "/f*.png"))]


def comp(rgba, bg):
    """straight-alpha RGBA -> float RGB composited on a flat background (what the page shows)"""
    a = rgba[..., 3:4].astype(np.float32) / 255
    return rgba[..., :3].astype(np.float32) * a + np.array(bg, np.float32) * (1 - a)


def luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def psnr(mse):
    return 99.0 if mse <= 1e-9 else float(10 * np.log10(255.0 ** 2 / mse))


def ssim(a, b, mask=None):
    """mean SSIM of two float luma images (gaussian 11x11, sigma 1.5), optionally over a boolean mask"""
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    g = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)
    ma, mb = g(a), g(b)
    saa, sbb, sab = g(a * a) - ma * ma, g(b * b) - mb * mb, g(a * b) - ma * mb
    m = ((2 * ma * mb + c1) * (2 * sab + c2)) / ((ma * ma + mb * mb + c1) * (saa + sbb + c2))
    return float(m[mask].mean()) if mask is not None and mask.any() else float(m.mean())


def grad(img):
    gx = cv2.Sobel(img, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(img, cv2.CV_32F, 0, 1, ksize=3)
    return np.sqrt(gx * gx + gy * gy)


def lapvar(img, mask):
    l = cv2.Laplacian(img, cv2.CV_32F, ksize=3)
    return float(l[mask].var()) if mask.any() else 0.0


def dil(m, r):
    return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0


def segment(src_rgba):
    """Regions of a lossless 384 px source frame: body, visor, eyes, floating pieces. Returns boolean masks at source resolution."""
    a = src_rgba[..., 3]
    m = (a > 128).astype(np.uint8)
    thick = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(thick)
    body = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8) if n > 1 else m
    cnt, _ = cv2.findContours(body, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = np.zeros_like(body)
    cv2.fillConvexPoly(hull, cv2.convexHull(max(cnt, key=cv2.contourArea)), 1)
    v = src_rgba[..., :3].max(axis=2) / 255.0
    dark = ((v < 0.12) & (hull > 0) & (a > 200)).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n2, l2, s2, _ = cv2.connectedComponentsWithStats(dark)
    visor = (l2 == 1 + int(np.argmax(s2[1:, cv2.CC_STAT_AREA]))) if n2 > 1 else np.zeros_like(m, bool)
    ys, xs = np.nonzero(visor)
    vbox = visor.copy()
    eyes = np.zeros_like(visor)
    if len(xs):
        vbox[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
        eyes = vbox & (v > 0.8) & (a > 200)
    pieces = (m > 0) & ~dil(body > 0, 5)
    pieces = cv2.morphologyEx(pieces.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
    return dict(body=body > 0, visor=visor, visor_box=vbox, eyes=eyes, pieces=pieces)


def to_side(mask, side):
    """source-resolution mask -> canvas resolution (the canvas shows the whole 384 px source frame)"""
    return cv2.resize(mask.astype(np.uint8), (side, side), interpolation=cv2.INTER_NEAREST) > 0


def piece_stats(alpha, body, min_area):
    """connected components of the floating pieces in an alpha plane (outside the dilated body)"""
    m = ((alpha > 128) & ~dil(body, 3)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    comps = [(float(cen[i][0]), float(cen[i][1]), int(st[i, cv2.CC_STAT_AREA])) for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= min_area]
    return comps
