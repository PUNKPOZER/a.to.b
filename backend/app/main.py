"""NOESIS advanced-analysis API (FastAPI + Essentia).

GET  /api/health            -> liveness + engine versions
POST /api/analyze           -> multipart `file`; returns normalised analysis JSON
GET  /api/analysis/{id}     -> cached result by content hash
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import essentia
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from . import analysis, sonic, structure
from .embeddings import FileEmbeddingStore
from pydantic import BaseModel
from .decode import DecodeError, decode_mono, decode_stereo, duration_seconds

ANALYSIS_VERSION = 3  # 1 legacy, 2 essentia.js, 3 essentia backend
MAX_UPLOAD_BYTES = int(os.getenv("SELECTOR_MAX_UPLOAD_MB", "200")) * 1024 * 1024
MAX_ANALYZE_SECONDS = float(os.getenv("SELECTOR_MAX_ANALYZE_SECONDS", "900"))
ALLOWED_EXT = {".mp3", ".wav", ".aif", ".aiff", ".flac", ".m4a", ".ogg"}
CACHE_DIR = Path(os.getenv("SELECTOR_CACHE_DIR", Path(tempfile.gettempdir()) / "selector-analysis-cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
EMBEDDINGS = FileEmbeddingStore(CACHE_DIR / "embeddings")
STRUCTURE_VERSION = 2
_struct_pool = ThreadPoolExecutor(max_workers=1)  # All-In-One / EffNet are RAM heavy: structure + embedding share ONE worker

# Explicit origins only (no wildcard). Extend with SELECTOR_CORS_ORIGINS="https://a,https://b".
ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:8000",
           "http://127.0.0.1:8787", "http://localhost:8787", "https://punkpozer.github.io"] + [o for o in os.getenv("SELECTOR_CORS_ORIGINS", "").split(",") if o]  # 8787 = NOESIS desktop app

app = FastAPI(title="NOESIS analysis API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])
_pool = ThreadPoolExecutor(max_workers=int(os.getenv("SELECTOR_WORKERS", "1")))  # CPU-bound: serialize by default


def _cache_path(aid: str) -> Path:
    if not aid.isalnum() or len(aid) > 64:
        raise HTTPException(400, "bad id")
    return CACHE_DIR / f"v{ANALYSIS_VERSION}_{aid}.json"


@app.get("/api/health")
def health():
    return {"status": "ok", "analysisVersion": ANALYSIS_VERSION, "essentia": essentia.__version__,
            "maxUploadMb": MAX_UPLOAD_BYTES // 1024 // 1024,
            "structure": {"available": structure.available(), "analyzer": "all-in-one-mlx"},
            "sonic": sonic.info()}


@app.get("/api/analysis/{aid}")
def get_analysis(aid: str):
    p = _cache_path(aid)
    if not p.exists():
        raise HTTPException(404, "not found")
    return json.loads(p.read_text())


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, f"unsupported file type {ext or '(none)'}")
    h = hashlib.sha256()
    size = 0
    fd, tmp = tempfile.mkstemp(suffix=ext, prefix="sel_")
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "file too large")
                h.update(chunk)
                out.write(chunk)
        aid = h.hexdigest()[:32]
        cp = _cache_path(aid)
        if cp.exists():
            res = json.loads(cp.read_text())
            res["cached"] = True
            return res

        def work():
            t0 = time.time()
            stereo = decode_stereo(tmp, MAX_ANALYZE_SECONDS)
            res = analysis.analyze(stereo, duration_seconds(tmp))
            res.update({"id": aid, "analysisVersion": ANALYSIS_VERSION, "cached": False,
                        "elapsedSeconds": round(time.time() - t0, 1)})
            return res

        try:
            res = await run_in_threadpool(lambda: _pool.submit(work).result())
        except DecodeError as e:
            raise HTTPException(422, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))
        cp.write_text(json.dumps(res))
        return res
    finally:
        try:
            os.unlink(tmp)  # audio is never kept
        except FileNotFoundError:
            pass


def _struct_cache(aid: str) -> Path:
    _cache_path(aid)  # validates id
    return CACHE_DIR / f"struct_v{STRUCTURE_VERSION}_{aid}.json"


@app.get("/api/structure/{aid}")
def get_structure(aid: str):
    p = _struct_cache(aid)
    if not p.exists():
        raise HTTPException(404, "not found")
    return json.loads(p.read_text())


@app.get("/api/embeddings/nearest/{aid}")
def nearest_embeddings(aid: str, k: int = 10, kind: str = "effnet"):
    _cache_path(aid)
    if kind not in ("effnet", "allin1"):
        raise HTTPException(400, "bad kind")
    return {"id": aid, "kind": kind, "nearest": [{"id": i, "cosine": round(c, 4)} for i, c in EMBEDDINGS.nearest(kind, aid, min(max(k, 1), 50))]}


@app.post("/api/structure")
async def analyze_structure(file: UploadFile = File(...)):
    if not structure.available():
        raise HTTPException(503, "structure analyzer not installed (run scripts/setup.sh)")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, f"unsupported file type {ext or '(none)'}")
    h, size = hashlib.sha256(), 0
    fd, tmp = tempfile.mkstemp(suffix=ext, prefix="sel_")
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "file too large")
                h.update(chunk)
                out.write(chunk)
        aid = h.hexdigest()[:32]
        cp = _struct_cache(aid)
        if cp.exists():
            res = json.loads(cp.read_text())
            res["cached"] = True
            return res

        def work():
            t0 = time.time()
            raw = structure.run(tmp)
            emb = raw.pop("embedding", None)
            if emb:
                EMBEDDINGS.put("allin1", aid, emb, {"model": raw["analyzer"]["model"], "modelVersion": raw["analyzer"]["version"]})
            res = {"id": aid, "structureVersion": STRUCTURE_VERSION, "analyzer": raw["analyzer"], "cached": False,
                   "embeddingDims": len(emb) if emb else 0,
                   "dj": structure.dj_features(raw, duration_seconds(tmp)),
                   "beatCount": len(raw["beats"]), "downbeats": raw["downbeats"]}
            res["elapsedSeconds"] = round(time.time() - t0, 1)
            return res

        try:
            res = await run_in_threadpool(lambda: _struct_pool.submit(work).result())
        except structure.StructureUnavailable as e:
            raise HTTPException(503, str(e))
        except RuntimeError as e:
            raise HTTPException(500, str(e))
        cp.write_text(json.dumps(res))
        return res
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


# ---------------- Sonic embeddings (Discogs-EffNet) ----------------
CAL_OVERRIDE = CACHE_DIR / "sonic_calibration.json"


def _provider() -> sonic.LocalEmbeddingProvider:
    return sonic.LocalEmbeddingProvider(EMBEDDINGS, sonic.load_calibration(CAL_OVERRIDE))


def _embed_summary(aid, vec, meta, extra=None):
    d = {"id": aid, "model": meta["model"], "modelVersion": meta["modelVersion"], "dims": int(len(vec)), "pooling": meta.get("pooling", sonic.POOLING),
         "createdAt": meta["createdAt"], "frameCount": meta.get("frameCount"), "frameHopSeconds": meta.get("frameHopSeconds"),
         "topStyles": meta.get("topStyles", []), "parents": meta.get("parents", []), "license": "CC BY-NC-SA 4.0"}
    d.update(extra or {})
    return d


@app.post("/api/embed")
async def embed_track(file: UploadFile = File(...)):
    """Compute (or return cached) Discogs-EffNet embedding. Cache key: audio hash + model id + model version."""
    if not sonic.available():
        raise HTTPException(503, "sonic embedding model runtime not installed (essentia-tensorflow)")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, f"unsupported file type {ext or '(none)'}")
    h, size = hashlib.sha256(), 0
    fd, tmp = tempfile.mkstemp(suffix=ext, prefix="sel_")
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "file too large")
                h.update(chunk)
                out.write(chunk)
        aid = h.hexdigest()[:32]
        if EMBEDDINGS.is_current("effnet", aid, sonic.MODEL_ID, sonic.MODEL_VERSION):
            vec, meta = EMBEDDINGS.get("effnet", aid)
            return _embed_summary(aid, vec, meta, {"cached": True})

        def work():
            t0 = time.time()
            audio = decode_mono(tmp, sonic.SAMPLE_RATE, sonic.MAX_SECONDS)
            r = sonic.embed(audio)
            meta = {"model": sonic.MODEL_ID, "modelVersion": sonic.MODEL_VERSION, "pooling": sonic.POOLING, "audioHash": aid,
                    "frameCount": r["frameCount"], "frameHopSeconds": r["frameHopSeconds"], "topStyles": r["topStyles"], "parents": r["parents"],
                    "createdAt": int(time.time())}
            EMBEDDINGS.put("effnet", aid, r["vector"], meta, frames=r["frames"])
            return _embed_summary(aid, r["vector"], meta, {"cached": False, "elapsedSeconds": round(time.time() - t0, 1),
                                                           "analyzedSeconds": round(len(audio) / sonic.SAMPLE_RATE, 1)})

        try:
            return await run_in_threadpool(lambda: _struct_pool.submit(work).result())
        except DecodeError as e:
            raise HTTPException(422, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))
        except RuntimeError as e:
            raise HTTPException(503, str(e))
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


class IdList(BaseModel):
    ids: list[str]


class SimilarReq(BaseModel):
    id: str
    candidates: list[str]
    k: int = 20


class BridgeReq(BaseModel):
    a: str
    b: str
    candidates: list[str]


class JourneyReq(BaseModel):
    a: str
    target: str
    candidates: list[str]
    steps: int = 4


MAX_IDS = 300


def _check_ids(*lists):
    for l in lists:
        if len(l) > MAX_IDS:
            raise HTTPException(413, f"too many ids (max {MAX_IDS}); a vector index (FAISS/pgvector) is needed beyond that")
        for i in l:
            _cache_path(i)  # validates


@app.post("/api/sonic/pairwise")
def sonic_pairwise(req: IdList):
    _check_ids(req.ids)
    return {"model": sonic.MODEL_ID, "modelVersion": sonic.MODEL_VERSION, **_provider().pairwise(req.ids)}


@app.post("/api/sonic/similar")
def sonic_similar(req: SimilarReq):
    _check_ids([req.id], req.candidates)
    return {"id": req.id, "results": _provider().similar(req.id, req.candidates, min(req.k, 100))}


@app.post("/api/sonic/bridge")
def sonic_bridge(req: BridgeReq):
    _check_ids([req.a, req.b], req.candidates)
    return {"results": _provider().bridge(req.a, req.b, req.candidates)}


@app.post("/api/sonic/journey")
def sonic_journey(req: JourneyReq):
    _check_ids([req.a, req.target], req.candidates)
    return {"path": _provider().journey(req.a, req.target, req.candidates, min(max(req.steps, 1), 12))}


@app.post("/api/sonic/recalibrate")
def sonic_recalibrate(req: IdList):
    """Re-derive the raw-cosine -> UI percentile table from the user's own library (needs >= 15 embedded tracks)."""
    _check_ids(req.ids)
    vecs = [e[0] for e in (EMBEDDINGS.get("effnet", i) for i in req.ids) if e is not None]
    if len(vecs) < 15:
        raise HTTPException(422, f"need at least 15 embedded tracks, have {len(vecs)}")
    cal = sonic.build_calibration(vecs, "user library")
    CAL_OVERRIDE.write_text(json.dumps(cal))
    return cal


@app.get("/api/sonic/providers")
def sonic_providers():
    ext = sonic.ExternalDiscoveryProvider()
    return {"local": {"name": "local-embedding", "available": sonic.available()},
            "external": {"name": ext.name, "implemented": False, "configured": ext.configured}}
