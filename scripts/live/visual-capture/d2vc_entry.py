"""Entry point of the packaged runtime (d2kiro-visual.exe): it has exactly one job, the supervised live loop."""
from d2vc.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
