"""Sonic similarity: Discogs-EffNet audio embeddings (official Essentia model) + calibration + providers.

Model: discogs-effnet-bs64-1 (Essentia Models, "EffnetDiscogs", Alonso-Jimenez et al., ISMIR 2022). Frozen TensorFlow
graph run through Essentia's own `TensorflowPredictEffnetDiscogs` algorithm (package essentia-tensorflow), CPU.
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
MODEL_FILE = "discogs-effnet-bs64-1.pb"
META_FILE = "discogs-effnet-bs64-1.json"
BASE_URL = "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/"
SHA256 = {MODEL_FILE: "3ed9af50d5367c0b9c795b294b00e7599e4943244f4cbd376869f3bfc87721b1",
          META_FILE: "a35003202384735c33154e20264267f9941705218a7b93202b655a1d408d4ff6"}
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


def ensure_model() -> Path:
    """Download (once) and verify the official model files."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, want in SHA256.items():
        p = MODEL_DIR / name
        if p.exists() and _sha(p) == want:
            continue
        tmp = p.with_suffix(p.suffix + ".part")
        urllib.request.urlretrieve(BASE_URL + name, tmp)
        if _sha(tmp) != want:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"checksum mismatch for {name}")
        tmp.replace(p)
    return MODEL_DIR / MODEL_FILE


def available() -> bool:
    try:
        import essentia.standard as es
        return hasattr(es, "TensorflowPredictEffnetDiscogs")
    except Exception:  # noqa: BLE001
        return False


def info() -> dict:
    return {"available": available(), "model": MODEL_ID, "modelVersion": MODEL_VERSION, "pooling": POOLING,
            "license": "CC BY-NC-SA 4.0", "modelDownloaded": all((MODEL_DIR / n).exists() for n in SHA256)}


def _load():
    if _models:
        return _models
    import essentia.standard as es
    graph = str(ensure_model())
    meta = json.loads((MODEL_DIR / META_FILE).read_text())
    emb = es.TensorflowPredictEffnetDiscogs(graphFilename=graph, output="PartitionedCall:1")
    pred = es.TensorflowPredictEffnetDiscogs(graphFilename=graph, output="PartitionedCall:0")
    hop_frames = emb.paramValue("patchHopSize")
    _models.update(emb=emb, pred=pred, classes=meta["classes"], hop_sec=hop_frames * 256 / SAMPLE_RATE)
    return _models


def embed(audio16k: np.ndarray) -> dict:
    """audio16k: float32 mono @16 kHz. Returns frames, track-level mean vector, top Discogs styles."""
    with _lock:
        m = _load()
        frames = np.asarray(m["emb"](audio16k), dtype=np.float32)
        preds = np.asarray(m["pred"](audio16k), dtype=np.float32)
    if frames.ndim != 2 or frames.shape[0] == 0:
        raise ValueError("model returned no embedding frames (audio too short?)")
    mean = frames.mean(axis=0)
    p = preds.mean(axis=0)
    top = np.argsort(-p)[:8]
    return {"frames": frames, "vector": mean, "dims": int(mean.shape[0]), "frameCount": int(frames.shape[0]),
            "frameHopSeconds": round(float(m["hop_sec"]), 4),
            "topStyles": [{"label": m["classes"][i], "score": round(float(p[i]), 4)} for i in top]}


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
