"""EmbeddingStore: abstraction for per-track embedding vectors.

Entries are namespaced by `kind` ("effnet" = Discogs-EffNet sonic embedding, "allin1" = All-In-One structure
embedding) and carry metadata (model id / version / audio hash / createdAt) so a changed model is detected as
"stale". First implementation = one .npz per (kind, track) on disk + brute-force cosine search; the Protocol is
deliberately small so it can be swapped for PostgreSQL+pgvector or FAISS without touching callers."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Protocol

import numpy as np


class EmbeddingStore(Protocol):
    def put(self, kind: str, track_id: str, vector, meta: dict, frames=None) -> None: ...
    def get(self, kind: str, track_id: str) -> tuple[np.ndarray, dict] | None: ...
    def frames(self, kind: str, track_id: str) -> np.ndarray | None: ...
    def ids(self, kind: str) -> list[str]: ...
    def nearest(self, kind: str, track_id: str, k: int = 10, among: list[str] | None = None) -> list[tuple[str, float]]: ...
    def is_current(self, kind: str, track_id: str, model: str, version: str) -> bool: ...


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


class FileEmbeddingStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, kind: str, track_id: str) -> Path:
        if not (kind.isalnum() and track_id.isalnum()):
            raise ValueError("bad id")
        d = self.root / kind
        d.mkdir(exist_ok=True)
        return d / f"{track_id}.npz"

    def put(self, kind, track_id, vector, meta, frames=None):
        arrays = {"vector": np.asarray(vector, dtype=np.float32), "meta": np.array(json.dumps({**meta, "createdAt": meta.get("createdAt", int(time.time()))}))}
        if frames is not None:  # kept (float16) for future section-level embeddings
            arrays["frames"] = np.asarray(frames, dtype=np.float16)
        np.savez_compressed(self._p(kind, track_id), **arrays)

    def get(self, kind, track_id):
        p = self._p(kind, track_id)
        if not p.exists():
            return None
        with np.load(p) as z:
            return z["vector"].astype(np.float32), json.loads(str(z["meta"]))

    def frames(self, kind, track_id):
        p = self._p(kind, track_id)
        if not p.exists():
            return None
        with np.load(p) as z:
            return z["frames"].astype(np.float32) if "frames" in z else None

    def ids(self, kind):
        d = self.root / kind
        return sorted(f.stem for f in d.glob("*.npz")) if d.exists() else []

    def nearest(self, kind, track_id, k=10, among=None):
        q = self.get(kind, track_id)
        if q is None:
            return []
        out = []
        for i in (among if among is not None else self.ids(kind)):
            if i == track_id:
                continue
            v = self.get(kind, i)
            if v is not None and v[0].shape == q[0].shape:
                out.append((i, cosine(q[0], v[0])))
        return sorted(out, key=lambda x: -x[1])[:k]

    def is_current(self, kind, track_id, model, version):
        e = self.get(kind, track_id)
        return bool(e and e[1].get("model") == model and e[1].get("modelVersion") == version)
