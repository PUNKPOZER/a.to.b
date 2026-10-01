"""Music structure analysis via All-In-One (isolated venv) + DJ-oriented features.

The analyzer runs in `structure/.venv` as a subprocess (no shell, argv only) so its heavy PyTorch/MLX
stack can never break the Essentia backend. `dj_features()` is pure Python and only reports what can be
derived from the analyzer output; it never labels a section "drop"."""
from __future__ import annotations

import json
import os
import statistics
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "structure"
PYTHON = Path(os.getenv("SELECTOR_STRUCTURE_PYTHON", ROOT / ".venv" / "bin" / "python"))
SCRIPT = Path(os.getenv("SELECTOR_STRUCTURE_SCRIPT", ROOT / "run_allin1.py"))
TIMEOUT_S = int(os.getenv("SELECTOR_STRUCTURE_TIMEOUT", "1200"))
MAJOR_DB = 3.0          # section-to-section loudness change treated as a major energy transition
SHORT_EDGE_S = 3.0      # 'start'/'end' markers shorter than this are merged into their neighbour


class StructureUnavailable(Exception):
    pass


def available() -> bool:
    return PYTHON.exists() and SCRIPT.exists()


def run(audio_path: str) -> dict:
    if not available():
        raise StructureUnavailable("structure analyzer not installed (run scripts/setup.sh)")
    fd, out = tempfile.mkstemp(suffix=".json", prefix="sel_struct_")
    os.close(fd)
    try:
        env = dict(os.environ)
        ff = os.getenv("SELECTOR_FFMPEG")
        if ff and os.path.isabs(ff):  # make the bundled ffmpeg visible to librosa / audio libraries in the child
            env["PATH"] = os.path.dirname(ff) + os.pathsep + env.get("PATH", "")
        p = subprocess.run([str(PYTHON), str(SCRIPT), audio_path, out], capture_output=True, timeout=TIMEOUT_S, env=env)
        if p.returncode != 0:
            raise RuntimeError("structure analyzer failed: " + p.stderr.decode("utf-8", "replace")[-300:])
        return json.loads(Path(out).read_text())
    finally:
        try:
            os.unlink(out)
        except FileNotFoundError:
            pass


def normalize_segments(segments: list[dict]) -> list[dict]:
    """Drop zero-length and tiny 'start'/'end' marker segments by extending the neighbour."""
    segs = [dict(s) for s in segments if s["end"] - s["start"] > 1e-3]
    out: list[dict] = []
    for s in segs:
        dur = s["end"] - s["start"]
        if s["label"] in ("start", "end") and dur < SHORT_EDGE_S:
            if out:
                out[-1]["end"] = s["end"]
            else:
                out.append({**s, "label": "__pending__"})
            continue
        if out and out[-1]["label"] == "__pending__":
            s = {**s, "start": out[-1]["start"]}
            out.pop()
        out.append(s)
    return [s for s in out if s["label"] != "__pending__"]


def dj_features(res: dict, duration: float | None = None) -> dict:
    segs = normalize_segments(res["segments"])
    downbeats = res.get("downbeats") or []
    bar = statistics.median([b - a for a, b in zip(downbeats, downbeats[1:])]) if len(downbeats) > 2 else None
    f: dict = {"segments": segs, "barSeconds": round(bar, 3) if bar else None,
               "firstDownbeat": downbeats[0] if downbeats else None,
               "bpm": res.get("bpm"), "downbeatCount": len(downbeats)}
    f["sectionBoundaries"] = [round(s["start"], 2) for s in segs[1:]]
    # intro / outro only when the analyzer itself labelled them
    intro = segs[0] if segs and segs[0]["label"] == "intro" else None
    outro = segs[-1] if segs and segs[-1]["label"] == "outro" else None
    f["introDuration"] = round(intro["end"] - intro["start"], 2) if intro else None
    f["outroDuration"] = round(outro["end"] - outro["start"], 2) if outro else None
    f["introBars"] = round(f["introDuration"] / bar) if intro and bar else None
    f["outroBars"] = round(f["outroDuration"] / bar) if outro and bar else None
    # energy changes at every boundary (from measured section loudness)
    changes = []
    for a, b in zip(segs, segs[1:]):
        if "energyDb" in a and "energyDb" in b:
            d = round(b["energyDb"] - a["energyDb"], 2)
            changes.append({"at": round(b["start"], 2), "from": a["label"], "to": b["label"], "deltaDb": d, "major": abs(d) >= MAJOR_DB})
    f["energySectionChanges"] = changes
    f["majorTransitions"] = [c["at"] for c in changes if c["major"]]
    # breakdown: a section the analyzer labelled break/bridge that is also clearly quieter (>=2 dB) than the track's loud sections
    energies = [s["energyDb"] for s in segs if "energyDb" in s]
    med = sorted(energies)[int(0.75 * (len(energies) - 1))] if energies else None  # reference = loud sections
    f["breakdownPositions"] = [round(s["start"], 2) for s in segs
                               if s["label"] in ("break", "bridge") and med is not None and s.get("energyDb", med) <= med - 2.0]
    return f
