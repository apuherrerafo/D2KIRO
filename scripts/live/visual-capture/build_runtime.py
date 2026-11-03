"""Builds the D2KIRO Visual runtime: one Windows folder with d2kiro-visual.exe (no Python needed on the Player's PC),
the hero portrait catalog and a manifest, zipped with its SHA-256.

    python build_runtime.py --version 0.1.0 [--out dist]

Build-time only (a developer machine or the `visual-runtime` GitHub workflow). Needs: opencv-python-headless numpy
windows-capture pyinstaller. The hero portrait catalog (public Valve CDN art) is NOT redistributed in the release: the runtime downloads it
once into the Player's local folder on first run (same public CDN the Dota client uses). `--bundle-catalog` exists for
local experiments only."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXE_NAME = "d2kiro-visual"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", default=str(HERE / "dist"))
    parser.add_argument("--bundle-catalog", action="store_true", help="ship Valve's hero portraits inside the zip (off by default: the runtime downloads them once on the Player's PC)")
    parser.add_argument("--min-heroes", type=int, default=120, help="with --bundle-catalog: refuse to package an incomplete catalog")
    args = parser.parse_args()

    sys.path.insert(0, str(HERE))
    from d2vc.catalog import LOCAL, fetch_catalog

    stored = 0
    data_args: list[str] = []
    if args.bundle_catalog:
        stored = fetch_catalog(LOCAL)
        if stored < args.min_heroes:
            print(f"catalog has {stored} heroes (< {args.min_heroes}): refusing to build", file=sys.stderr)
            return 2
        separator = ";" if sys.platform == "win32" else ":"
        data_args = ["--add-data", f"{LOCAL / 'portraits'}{separator}local/portraits", "--add-data", f"{LOCAL / 'catalog.json'}{separator}local"]

    out = Path(args.out).resolve()
    work = out / "work"
    shutil.rmtree(out, ignore_errors=True)
    work.mkdir(parents=True)
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--noconsole",
            "--name", EXE_NAME,
            "--distpath", str(out / "dist"), "--workpath", str(work), "--specpath", str(work),
            "--paths", str(HERE),
            *data_args,
            "--collect-all", "windows_capture",
            str(HERE / "d2vc_entry.py"),
        ],
        check=True,
    )
    folder = out / "dist" / EXE_NAME
    exe = folder / f"{EXE_NAME}.exe"
    if not exe.exists():
        print("build produced no executable", file=sys.stderr)
        return 3
    (folder / "manifest.json").write_text(json.dumps({"name": EXE_NAME, "version": args.version, "bundledHeroes": stored}, indent=1), encoding="utf-8")

    archive = out / f"{EXE_NAME}-{args.version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(folder).as_posix())
    digest = sha256_of(archive)
    (out / f"{archive.name}.sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(json.dumps({"archive": archive.name, "sha256": digest, "bytes": archive.stat().st_size, "bundledHeroes": stored}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
