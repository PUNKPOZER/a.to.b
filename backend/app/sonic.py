"""Sonic similarity: Discogs-EffNet audio embeddings (official Essentia model) + calibration + providers.

Model: discogs-effnet-bs64-1 (Essentia Models, "EffnetDiscogs", Alonso-Jimenez et al., ISMIR 2022). Two interchangeable
runtimes give the same numbers (verified: embedding cosine 1.000000, activations within 1e-5):
  * "essentia-tensorflow": the frozen TensorFlow graph through Essentia's `TensorflowPredictEffnetDiscogs` (macOS / Linux);
  * "onnxruntime": the official ONNX export of the same model + a numpy re-implementation of Essentia's mel front-end
    (`effnet_onnx.py`) — the portable path used on Windows, where Essentia has no build. CPU only in both cases.
Input 16 kHz mono; output per ~1 s frame: 1280-d embedding (PartitionedCall:1) and 400 Discogs style activations
(PartitionedCall:0). Model license: CC BY-NC-SA 4.0 (non-commercial; proprietary licence available from the MTG).

Track-level aggregation: mean pooling over frames (the usage shown in Essentia's own examples); per-frame embeddings
are also kept (float16) in the store so section-level embeddings can be built later (see `section_embedding`)."""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.request
import warnings
from pathlib import Path
from typing import Protocol

import numpy as np

warnings.filterwarnings("ignore")

MODEL_ID = "discogs-effnet-bs64"
MODEL_VERSION = "1"
_CFG = json.loads(Path(__file__).with_name("model_files.json").read_text())
BASE_URLS = _CFG["baseUrls"]   # tried in order: the MTG server, then our GitHub release mirror (same files, same sha256)
FILES = _CFG["files"]          # runtime -> {file: sha256}; the class list (400 Discogs styles) is identical in both json files
MODEL_DIR = Path(os.getenv("SELECTOR_MODEL_DIR", Path(__file__).resolve().parents[1] / "models"))
SAMPLE_RATE = 16000
POOLING = "mean"
MAX_SECONDS = float(os.getenv("SELECTOR_MAX_EMBED_SECONDS", "900"))
CALIBRATION_DEFAULT = Path(__file__).with_name("sonic_calibration.json")

_lock = threading.Lock()
_models: dict = {}


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def runtime() -> str | None:
    """Which runtime will run the model. SELECTOR_PORTABLE=1 forces the ONNX path (used for testing / Windows)."""
    if os.getenv("SELECTOR_PORTABLE") != "1" and os.getenv("SELECTOR_SONIC_RUNTIME") != "onnx":
        try:
            import essentia.standard as es
            if hasattr(es, "TensorflowPredictEffnetDiscogs"):
                return "essentia-tensorflow"
        except Exception:  # noqa: BLE001
            pass
    try:
        import onnxruntime  # noqa: F401
        return "onnxruntime"
    except Exception:  # noqa: BLE001
        return None


def ensure_model(rt: str | None = None) -> Path:
    """Download (once) and verify the official model files for the runtime; returns the model file path."""
    rt = rt or runtime()
    if rt is None:
        raise RuntimeError("no runtime for the Discogs-EffNet model (install essentia-tensorflow or onnxruntime)")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    files = FILES[rt]
    for name, want in files.items():
        p = MODEL_DIR / name
        if p.exists() and _sha(p) == want:
            continue
        tmp = p.with_suffix(p.suffix + ".part")
        errors = []
        for base in BASE_URLS:
            try:
                urllib.request.urlretrieve(base + name, tmp)
                if _sha(tmp) != want:
                    raise RuntimeError("checksum mismatch")
                tmp.replace(p)
                break
            except Exception as e:  # noqa: BLE001 - try the next mirror
                tmp.unlink(missing_ok=True)
                errors.append(f"{base}: {e}")
        else:
            raise RuntimeError(f"could not download {name}: " + " | ".join(errors))
    return MODEL_DIR / next(n for n in files if not n.endswith(".json"))


def available() -> bool:
    return runtime() is not None


def info() -> dict:
    rt = runtime()
    have = rt is not None and all((MODEL_DIR / n).exists() for n in FILES[rt])
    return {"available": rt is not None, "runtime": rt, "model": MODEL_ID, "modelVersion": MODEL_VERSION, "pooling": POOLING,
            "license": "CC BY-NC-SA 4.0", "modelDownloaded": have}


def _load():
    if _models:
        return _models
    rt = runtime()
    path = ensure_model(rt)
    meta = json.loads((MODEL_DIR / next(n for n in FILES[rt] if n.endswith(".json"))).read_text())
    if rt == "essentia-tensorflow":
        import essentia.standard as es
        emb = es.TensorflowPredictEffnetDiscogs(graphFilename=str(path), output="PartitionedCall:1")
        pred = es.TensorflowPredictEffnetDiscogs(graphFilename=str(path), output="PartitionedCall:0")
        _models.update(runtime=rt, emb=emb, pred=pred, hop_sec=emb.paramValue("patchHopSize") * 256 / SAMPLE_RATE)
    else:
        from .effnet_onnx import EffnetOnnx, HOP, PATCH_HOP
        _models.update(runtime=rt, onnx=EffnetOnnx(str(path)), hop_sec=PATCH_HOP * HOP / SAMPLE_RATE)
    _models["classes"] = meta["classes"]
    return _models


def embed(audio16k: np.ndarray) -> dict:
    """audio16k: float32 mono @16 kHz. Returns frames, track-level mean vector, top Discogs styles."""
    with _lock:
        m = _load()
        if m["runtime"] == "essentia-tensorflow":
            frames = np.asarray(m["emb"](audio16k), dtype=np.float32)
            preds = np.asarray(m["pred"](audio16k), dtype=np.float32)
        else:
            frames, preds = m["onnx"].run(audio16k)
    if frames.ndim != 2 or frames.shape[0] == 0:
        raise ValueError("model returned no embedding frames (audio too short?)")
    mean = frames.mean(axis=0)
    p = preds.mean(axis=0)
    top = np.argsort(-p)[:12]
    parents: dict[str, float] = {}  # top-level Discogs genre = strongest of its styles
    for i, sc in enumerate(p):
        g = m["classes"][i].split("---")[0]
        parents[g] = max(parents.get(g, 0.0), float(sc))
    return {"frames": frames, "vector": mean, "dims": int(mean.shape[0]), "frameCount": int(frames.shape[0]),
            "frameHopSeconds": round(float(m["hop_sec"]), 4),
            "topStyles": [{"label": m["classes"][i], "score": round(float(p[i]), 4)} for i in top],
            "parents": [{"label": g, "score": round(sc, 4)} for g, sc in sorted(parents.items(), key=lambda kv: -kv[1])[:4]]}


def section_embedding(frames: np.ndarray, hop_sec: float, start: float, end: float) -> np.ndarray | None:
    """Mean-pooled embedding of one section (future section-level similarity)."""
    a, b = int(start / hop_sec), max(int(end / hop_sec), int(start / hop_sec) + 1)
    seg = frames[a:b]
    return seg.mean(axis=0) if len(seg) else None


# ---------------- calibration: raw cosine -> UI percentage ----------------
def load_calibration(override: Path | None = None) -> dict:
    for p in (override, CALIBRATION_DEFAULT):
        if p and Path(p).exists():
            return json.loads(Path(p).read_text())
    return {"percentiles": [0, 100], "rawQuantiles": [0.0, 1.0], "source": "identity (uncalibrated)"}


def calibrate(raw: float, cal: dict) -> float:
    """UI score = percentile of `raw` among cosines of typical track pairs (monotone piecewise-linear).
    94% reads as "more alike than 94% of random pairs of tracks"; it is NOT the cosine value."""
    return round(float(np.interp(raw, cal["rawQuantiles"], cal["percentiles"])), 1)


def build_calibration(vectors: list[np.ndarray], source: str) -> dict:
    v = np.array([x / (np.linalg.norm(x) + 1e-12) for x in vectors])
    sims = (v @ v.T)[np.triu_indices(len(v), 1)]
    pct = [0, 1, 5, 10, 25, 50, 75, 90, 95, 99, 100]
    q = np.percentile(sims, pct)
    # enforce strictly increasing quantiles for np.interp
    for i in range(1, len(q)):
        q[i] = max(q[i], q[i - 1] + 1e-6)
    return {"percentiles": pct, "rawQuantiles": [round(float(x), 5) for x in q], "pairs": int(len(sims)),
            "tracks": int(len(v)), "source": source, "model": MODEL_ID, "modelVersion": MODEL_VERSION,
            "createdAt": int(time.time())}


# ---------------- providers ----------------
class SimilarityProvider(Protocol):
    name: str
    def similar(self, query_id: str, candidate_ids: list[str], k: int) -> list[dict]: ...


class ExternalProviderNotConfigured(Exception):
    pass


class LocalEmbeddingProvider:
    """Searches the user's own library by Discogs-EffNet embeddings. Audio never leaves our architecture."""
    name = "local-embedding"

    def __init__(self, store, calibration: dict):
        self.store, self.cal = store, calibration

    def _unit(self, tid):
        e = self.store.get("effnet", tid)
        return None if e is None else e[0] / (np.linalg.norm(e[0]) + 1e-12)

    def pairwise(self, ids: list[str]) -> dict:
        have = [(i, self._unit(i)) for i in ids]
        ok = [(i, v) for i, v in have if v is not None]
        m = np.array([v for _, v in ok]) if ok else np.zeros((0, 1))
        raw = (m @ m.T) if ok else np.zeros((0, 0))
        ui = np.vectorize(lambda x: calibrate(float(x), self.cal))(raw) if ok else raw
        return {"ids": [i for i, _ in ok], "missing": [i for i, v in have if v is None],
                "raw": np.round(raw, 4).tolist(), "ui": np.round(ui, 1).tolist()}

    def similar(self, query_id, candidate_ids, k):
        q = self._unit(query_id)
        if q is None:
            return []
        out = []
        for c in candidate_ids:
            if c == query_id:
                continue
            u = self._unit(c)
            if u is not None:
                r = float(np.dot(q, u))
                out.append({"id": c, "raw": round(r, 4), "ui": calibrate(r, self.cal)})
        return sorted(out, key=lambda x: -x["raw"])[:k]

    def bridge(self, a: str, b: str, candidate_ids: list[str]) -> list[dict]:
        """Where does each candidate sit relative to the A->B segment in embedding space?
        t = position along A->B (0..1), residual = distance off the segment (relative to |A-B|)."""
        ua, ub = self._unit(a), self._unit(b)
        if ua is None or ub is None:
            return []
        d = ub - ua
        dn2 = float(np.dot(d, d)) + 1e-12
        out = []
        for c in candidate_ids:
            if c in (a, b):
                continue
            uc = self._unit(c)
            if uc is None:
                continue
            t = float(np.dot(uc - ua, d) / dn2)
            resid = float(np.linalg.norm(uc - (ua + np.clip(t, 0, 1) * d)) / (np.sqrt(dn2)))
            inside = 1.0 if 0.15 <= t <= 0.85 else max(0.0, 1 - min(abs(t - 0.15), abs(t - 0.85)) / 0.3)
            between = max(0.0, 1 - resid) * inside
            ra, rb = float(np.dot(uc, ua)), float(np.dot(uc, ub))
            out.append({"id": c, "t": round(t, 3), "residual": round(resid, 3), "between": round(between, 3),
                        "rawA": round(ra, 4), "rawB": round(rb, 4),
                        "uiA": calibrate(ra, self.cal), "uiB": calibrate(rb, self.cal)})
        return sorted(out, key=lambda x: -x["between"])

    def journey(self, a: str, target: str, candidate_ids: list[str], steps: int) -> list[dict]:
        """Sonic journey (architecture only, no UI yet): waypoints interpolated from A to Target in the
        normalised embedding space; each waypoint is filled with the nearest unused real library track."""
        ua, ut = self._unit(a), self._unit(target)
        if ua is None or ut is None:
            return []
        units = {c: self._unit(c) for c in candidate_ids if c not in (a, target)}
        units = {c: u for c, u in units.items() if u is not None}
        path, used = [], set()
        for s in range(1, steps + 1):
            w = ua + (ut - ua) * (s / (steps + 1))
            w = w / (np.linalg.norm(w) + 1e-12)
            best = max(((c, float(np.dot(w, u))) for c, u in units.items() if c not in used), key=lambda x: x[1], default=None)
            if best:
                used.add(best[0])
                path.append({"step": s, "id": best[0], "cosineToWaypoint": round(best[1], 4)})
        return path


class ExternalDiscoveryProvider:
    """Placeholder for a future 'discover outside my library' provider (e.g. cosine.club, subject to its API terms).
    Not implemented and NOT a dependency. Any API key must come from the server environment only."""
    name = "external-discovery"

    @property
    def configured(self) -> bool:
        return bool(os.getenv("SELECTOR_EXTERNAL_DISCOVERY_KEY"))

    def similar(self, query_id, candidate_ids, k):
        raise ExternalProviderNotConfigured("external discovery is not implemented")
