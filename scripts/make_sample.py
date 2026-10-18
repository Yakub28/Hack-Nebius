"""Build web/sample.json: one real search, recorded, so the UI can show it instantly and without a key.

Runs the full engine, so it needs NEBIUS_API_KEY, and TAVILY_API_KEY for the web agent and web context.
The UI labels the page as a recorded run, with its date.

Run: make sample
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import _discovery_json  # noqa: E402
from engine import http  # noqa: E402
from engine.discover import discover  # noqa: E402

QUESTION = "Which incretin-based drugs reduce body weight in adults with obesity?"
SEEDS = ["33567185", "35658024"]   # STEP 1 (semaglutide), SURMOUNT-1 (tirzepatide)


async def main() -> None:
    try:
        found = await discover(QUESTION, SEEDS, limit=50)
    finally:
        await http.close()
    data = _discovery_json(found)
    data["recorded"] = datetime.now(UTC).date().isoformat()
    out = ROOT / "web" / "sample.json"
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    print(f"wrote {out}: {len(found.results)} results, {sum(found.timings.values()):.0f} s, "
          f"{len(found.warnings)} warnings")
    for warning in found.warnings:
        print("  warning:", warning)


asyncio.run(main())
