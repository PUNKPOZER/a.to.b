"""Advanced MIR analysis with Essentia (Python).

Accuracy strategy (every step reports its own agreement measure):
* BPM: three independent Essentia estimators (RhythmExtractor2013 multifeature,
  BeatTrackerDegara, PercivalBpmEstimator) are octave-normalised and combined;
  the final value is refined by a robust linear fit of the beat grid, which is
  far more precise than the estimators' own quantised output for steady tempo.
* Key: several key profiles are run over the whole track AND over consecutive
  segments; the winning Camelot code is chosen by strength-weighted vote and
  the share of the vote is the reliability.
Only compact aggregates are returned (no beat arrays / frame matrices).
"""
from __future__ import annotations

import warnings
from collections import defaultdict

import numpy as np

warnings.filterwarnings("ignore")
import essentia  # noqa: E402
import essentia.standard as es  # noqa: E402

from .camelot import normalize_key, to_camelot  # noqa: E402
from .decode import SR  # noqa: E402

essentia.log.infoActive = False
essentia.log.warningActive = False

BPM_MIN, BPM_MAX = 70.0, 190.0
KEY_PROFILES = ["bgate", "edma", "edmm", "shaath", "temperley", "krumhansl"]
SEGMENT_SECONDS = 40


def _fold(bpm: float) -> float:
    while 0 < bpm < BPM_MIN:
        bpm *= 2
    while bpm > BPM_MAX:
        bpm /= 2
    return bpm


def _to_octave(bpm: float, ref: float) -> float:
    """Scale bpm by a power of two so it is closest to ref."""
    best, bd = bpm, abs(bpm - ref)
    for f in (0.5, 2.0):
        if abs(bpm * f - ref) < bd:
            best, bd = bpm * f, abs(bpm * f - ref)
    return best


def _grid_bpm(ticks: np.ndarray) -> tuple[float | None, float | None]:
    """Robust beat-grid fit: bpm from slope of beat time vs index (outliers
    trimmed). Returns (bpm, residual_ms) or (None, None)."""
    if len(ticks) < 16:
        return None, None
    idx = np.arange(len(ticks), dtype=float)
    keep = np.ones(len(ticks), bool)
    slope = icpt = 0.0
    for _ in range(3):
        slope, icpt = np.polyfit(idx[keep], ticks[keep], 1)
        res = ticks - (slope * idx + icpt)
        mad = np.median(np.abs(res[keep] - np.median(res[keep]))) + 1e-6
        keep = np.abs(res) < 4 * 1.4826 * mad + 0.01
        if keep.sum() < 12:
            return None, None
    res = ticks[keep] - (slope * idx[keep] + icpt)
    return 60.0 / slope, float(np.sqrt(np.mean(res ** 2)) * 1000)


def analyze_bpm(mono: np.ndarray) -> dict:
    out: dict = {"estimators": {}, "errors": {}}
    ticks = np.array([])
    try:
        bpm, ticks, conf, _est, _iv = es.RhythmExtractor2013(method="multifeature", minTempo=40, maxTempo=208)(mono)
        out["estimators"]["rhythm_extractor_multifeature"] = float(bpm)
        out["modelConfidence"] = float(conf)  # 0..5.32, Essentia's own measure
        ticks = np.asarray(ticks)
    except Exception as e:  # noqa: BLE001
        out["errors"]["multifeature"] = str(e)
    try:
        t2 = np.asarray(es.BeatTrackerDegara()(mono))
        if len(t2) > 8:
            out["estimators"]["beat_tracker_degara"] = float(60.0 / np.median(np.diff(t2)))
    except Exception as e:  # noqa: BLE001
        out["errors"]["degara"] = str(e)
    try:
        out["estimators"]["percival"] = float(es.PercivalBpmEstimator()(mono))
    except Exception as e:  # noqa: BLE001
        out["errors"]["percival"] = str(e)

    est = {k: v for k, v in out["estimators"].items() if v and v > 0}
    if not est:
        out["value"] = None
        out["reliability"] = 0
        return out
    anchor = est.get("rhythm_extractor_multifeature") or float(np.median(list(est.values())))
    norm = {k: _to_octave(v, anchor) for k, v in est.items()}
    med = float(np.median(list(norm.values())))
    agree = [k for k, v in norm.items() if abs(v - med) / med * 100 <= 3.0]
    grid, resid_ms = _grid_bpm(ticks)
    value = med
    if grid:
        grid = _to_octave(grid, med)
        if abs(grid - med) / med * 100 <= 3.0:  # grid fit confirms the estimators -> use its precision
            value = grid
            out["gridResidualMs"] = round(resid_ms, 1)
    folded = _fold(value)
    out["value"] = round(folded, 2)
    out["octaveFolded"] = bool(abs(folded - value) > 1e-6)
    out["alternatives"] = sorted({round(float(folded) / 2, 2), round(float(folded) * 2, 2)})
    out["agreeing"] = agree
    out["reliability"] = int(round(100 * len(agree) / len(norm))) if len(norm) > 1 else 40
    if out["reliability"] >= 100 and out.get("gridResidualMs") is not None and out["gridResidualMs"] > 40:
        out["reliability"] = 85  # estimators agree but the beat grid is loose (live / swung material)
    out["beatCount"] = int(len(ticks))
    out["firstBeatSec"] = round(float(ticks[0]), 3) if len(ticks) else None
    if len(ticks) > 4:
        iv = np.diff(ticks)
        out["beatIntervalCv"] = round(float(np.std(iv) / np.mean(iv)), 4)
    return out


def analyze_key(mono: np.ndarray) -> dict:
    votes: dict[str, float] = defaultdict(float)
    detail = []
    seg = SEGMENT_SECONDS * SR
    chunks = [mono] + [mono[i:i + seg] for i in range(0, len(mono) - seg // 2, seg)]
    total = 0.0
    for ci, chunk in enumerate(chunks):
        weight = 2.0 if ci == 0 else 1.0  # whole-track result counts double
        for prof in KEY_PROFILES:
            try:
                key, scale, strength = es.KeyExtractor(profileType=prof, sampleRate=SR)(chunk)
            except Exception:  # noqa: BLE001
                continue
            cam = to_camelot(key, scale)
            if not cam or strength <= 0:
                continue
            w = weight * float(strength)
            votes[cam] += w
            total += w
            if ci == 0:
                detail.append({"profile": prof, "key": normalize_key(key), "scale": scale,
                               "camelot": cam, "strength": round(float(strength), 3)})
    if not votes:
        return {"value": None, "reliability": 0}
    cam, w = max(votes.items(), key=lambda kv: kv[1])
    top = next((d for d in sorted(detail, key=lambda d: -d["strength"]) if d["camelot"] == cam), None)
    if top is None:
        top = {"key": None, "scale": None, "strength": None}
    runner = sorted(votes.items(), key=lambda kv: -kv[1])[1:2]
    return {"value": cam, "key": top["key"], "scale": top["scale"], "reliability": int(round(100 * w / total)),
            "modelStrength": top["strength"], "runnerUp": runner[0][0] if runner else None, "profiles": detail}


def analyze_timbre(mono: np.ndarray, max_frames: int = 3000) -> dict:
    frame, hop = 2048, 1024
    win, spec = es.Windowing(type="hann"), es.Spectrum()
    mfcc, contrast = es.MFCC(), es.SpectralContrast(frameSize=frame)
    centroid, rolloff, flux = es.Centroid(range=SR / 2), es.RollOff(), es.Flux()
    frames = list(es.FrameGenerator(mono, frameSize=frame, hopSize=hop, startFromZero=True))
    if len(frames) > max_frames:
        step = len(frames) / max_frames
        frames = [frames[int(i * step)] for i in range(max_frames)]
    mf, sc, cen, rol, flx = [], [], [], [], []
    prev = None
    for f in frames:
        s = spec(win(f))
        mf.append(mfcc(s)[1])
        sc.append(contrast(s)[0])
        cen.append(centroid(s))
        rol.append(rolloff(s))
        if prev is not None:
            flx.append(flux(s))
        prev = s
    mf, sc = np.array(mf), np.array(sc)
    return {
        "mfccMean": [round(float(x), 3) for x in mf.mean(axis=0)],
        "spectralContrastMean": [round(float(x), 3) for x in sc.mean(axis=0)],
        "spectralCentroidHz": round(float(np.mean(cen)), 1),
        "spectralRolloffHz": round(float(np.mean(rol)), 1),
        "spectralFluxMean": round(float(np.mean(flx)), 4) if flx else None,
    }


def analyze_energy(stereo: np.ndarray, mono: np.ndarray) -> dict:
    out: dict = {}
    try:
        _m, _s, integrated, lra = es.LoudnessEBUR128(sampleRate=SR)(stereo)
        out["loudnessLufs"] = round(float(integrated), 2)
        out["loudnessRangeLu"] = round(float(lra), 2)
    except Exception as e:  # noqa: BLE001
        out["loudnessError"] = str(e)
    try:
        dc, _ = es.DynamicComplexity(sampleRate=SR)(mono)
        out["dynamicComplexity"] = round(float(dc), 3)
    except Exception:  # noqa: BLE001
        pass
    # coarse energy curve: RMS per ~1/120 of the track, normalised 0..1
    n = 120
    seg = max(1, len(mono) // n)
    rms = np.array([np.sqrt(np.mean(mono[i * seg:(i + 1) * seg] ** 2)) for i in range(n)])
    if rms.max() > 0:
        out["energyCurve"] = [round(float(x), 3) for x in rms / rms.max()]
    return out


def analyze_rhythm_extras(mono: np.ndarray) -> dict:
    out = {}
    try:
        out["danceability"] = round(float(es.Danceability(sampleRate=SR)(mono)[0]), 3)
    except Exception:  # noqa: BLE001
        pass
    try:
        _on, rate = es.OnsetRate()(mono)
        out["onsetRate"] = round(float(rate), 3)
    except Exception:  # noqa: BLE001
        pass
    return out


def analyze(stereo: np.ndarray, duration: float | None) -> dict:
    mono = np.ascontiguousarray(stereo.mean(axis=1), dtype=np.float32)
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    if peak < 1e-4:
        raise ValueError("audio is silent")
    bpm = analyze_bpm(mono)
    key = analyze_key(mono)
    return {
        "engine": {"name": "essentia", "version": essentia.__version__},
        "analyzedSeconds": round(len(mono) / SR, 1),
        "durationSeconds": duration,
        "bpm": bpm,
        "key": key,
        "rhythm": analyze_rhythm_extras(mono),
        "timbre": analyze_timbre(mono),
        "energy": analyze_energy(stereo, mono),
    }
