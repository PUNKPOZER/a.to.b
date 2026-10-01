"""Accuracy tests on synthetic audio with KNOWN ground truth."""
import io
import subprocess
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app

SR = 44100


def make_track(bpm=128.0, seconds=40, chord=(57, 60, 64)):  # A minor triad (A C E)
    n = int(SR * seconds)
    t = np.arange(n) / SR
    y = np.zeros(n, dtype=np.float32)
    beat = 60.0 / bpm
    for k in range(int(seconds / beat)):
        i = int(k * beat * SR)
        m = min(n - i, int(0.12 * SR))
        tt = np.arange(m) / SR
        y[i:i + m] += (0.9 * np.sin(2 * np.pi * (110 * np.exp(-tt * 18)) * tt) * np.exp(-tt * 14)).astype(np.float32)
        h = int(k * beat * SR + beat * SR / 2)  # off-beat hat
        if h + 600 < n:
            y[h:h + 600] += (np.random.RandomState(k).randn(600) * 0.15 * np.exp(-np.arange(600) / 120)).astype(np.float32)
    for midi in chord:
        f = 440 * 2 ** ((midi - 69) / 12)
        y += 0.12 * np.sin(2 * np.pi * f * t).astype(np.float32)
        y += 0.05 * np.sin(2 * np.pi * 2 * f * t).astype(np.float32)
    return y / max(1e-9, np.abs(y).max()) * 0.8


def wav_bytes(y):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype("<i2").tobytes())
    return buf.getvalue()


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_known_bpm_and_key_wav(client):
    r = client.post("/api/analyze", files={"file": ("t.wav", wav_bytes(make_track(128.0)), "audio/wav")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert abs(j["bpm"]["value"] - 128.0) < 0.6, j["bpm"]
    assert j["key"]["value"] == "8A", j["key"]  # A minor
    assert j["timbre"]["mfccMean"] and j["energy"]["loudnessLufs"] is not None
    # cached second call + retrievable by id
    r2 = client.post("/api/analyze", files={"file": ("t.wav", wav_bytes(make_track(128.0)), "audio/wav")})
    assert r2.json()["cached"] is True
    assert client.get("/api/analysis/" + j["id"]).status_code == 200


def test_known_bpm_mp3(client, tmp_path):
    wav = tmp_path / "a.wav"; wav.write_bytes(wav_bytes(make_track(124.0)))
    mp3 = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), str(mp3)], check=True)
    r = client.post("/api/analyze", files={"file": ("a.mp3", mp3.read_bytes(), "audio/mpeg")})
    assert r.status_code == 200, r.text
    assert abs(r.json()["bpm"]["value"] - 124.0) < 0.8


def test_rejects_bad_type_and_garbage_and_silence(client):
    assert client.post("/api/analyze", files={"file": ("x.exe", b"abc", "application/octet-stream")}).status_code == 415
    assert client.post("/api/analyze", files={"file": ("x.mp3", b"not audio at all" * 500, "audio/mpeg")}).status_code == 422
    assert client.post("/api/analyze", files={"file": ("s.wav", wav_bytes(np.zeros(SR * 5, np.float32)), "audio/wav")}).status_code == 422
    assert client.get("/api/analysis/../etc").status_code in (400, 404)


def test_cors_allows_pages_origin_only(client):
    ok = client.options("/api/health", headers={"Origin": "https://punkpozer.github.io", "Access-Control-Request-Method": "GET"})
    bad = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://punkpozer.github.io"
    assert "access-control-allow-origin" not in bad.headers


# ---------------- Phase 3: structure ----------------
from app import structure  # noqa: E402


def _res(segs, downbeats):
    return {"segments": segs, "downbeats": downbeats, "bpm": 120}


def test_dj_features_intro_outro_and_transitions():
    segs = [{"start": 0, "end": 0.1, "label": "start", "energyDb": -60},
            {"start": 0.1, "end": 16.1, "label": "intro", "energyDb": -24},
            {"start": 16.1, "end": 48.1, "label": "chorus", "energyDb": -12},
            {"start": 48.1, "end": 64.1, "label": "break", "energyDb": -22},
            {"start": 64.1, "end": 96.1, "label": "chorus", "energyDb": -12},
            {"start": 96.1, "end": 112.1, "label": "outro", "energyDb": -26}]
    db = [i * 2.0 for i in range(56)]  # 2 s bars (120 BPM, 4/4)
    f = structure.dj_features(_res(segs, db))
    assert f["segments"][0]["label"] == "intro" and f["segments"][0]["start"] == 0  # start marker merged away
    assert f["barSeconds"] == 2.0 and f["introBars"] == 8 and f["outroBars"] == 8
    assert f["breakdownPositions"] == [48.1]
    assert 16.1 in f["majorTransitions"] and 48.1 in f["majorTransitions"]
    assert all(s["label"] != "drop" for s in f["segments"])  # never invents "drop"


def test_dj_features_no_intro_label_means_none():
    f = structure.dj_features(_res([{"start": 0, "end": 30, "label": "verse", "energyDb": -15}], [0, 2, 4, 6]))
    assert f["introDuration"] is None and f["outroDuration"] is None and f["introBars"] is None


def test_embedding_store_nearest(tmp_path):
    from app.embeddings import FileEmbeddingStore
    s = FileEmbeddingStore(tmp_path)
    for i, v in {"a": [1, 0, 0], "b": [0.9, 0.1, 0], "c": [0, 1, 0]}.items():
        s.put("effnet", i, v, {"model": "m", "modelVersion": "1"})
    assert [i for i, _ in s.nearest("effnet", "a", 2)] == ["b", "c"]


@pytest.mark.skipif(not structure.available(), reason="structure venv not installed")
def test_structure_endpoint_on_real_model(client):
    r = client.post("/api/structure", files={"file": ("t.wav", wav_bytes(make_track(124.0, seconds=60)), "audio/wav")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["dj"]["segments"] and j["downbeats"] and j["embeddingDims"] == 768
    assert client.get("/api/structure/" + j["id"]).status_code == 200
    assert client.get("/api/embeddings/nearest/" + j["id"]).status_code == 200


# ---------------- Sonic embeddings ----------------
from app import sonic as sonic_mod  # noqa: E402
from app.embeddings import FileEmbeddingStore  # noqa: E402


def test_calibration_is_monotone_and_not_raw_cosine():
    cal = sonic_mod.build_calibration([np.random.RandomState(i).randn(32) + 2.0 for i in range(20)], "synthetic")
    xs = [sonic_mod.calibrate(r, cal) for r in np.linspace(-1, 1, 41)]
    assert xs == sorted(xs) and xs[0] == 0.0 and xs[-1] == 100.0


def test_store_metadata_staleness_and_frames(tmp_path):
    s = FileEmbeddingStore(tmp_path)
    s.put("effnet", "abc", [1, 2, 3], {"model": "m", "modelVersion": "1"}, frames=np.ones((5, 3)))
    assert s.is_current("effnet", "abc", "m", "1")
    assert not s.is_current("effnet", "abc", "m", "2")      # model changed -> stale
    assert not s.is_current("effnet", "zzz", "m", "1")      # missing
    assert s.frames("effnet", "abc").shape == (5, 3)
    f = s.frames("effnet", "abc")
    assert sonic_mod.section_embedding(f, 1.0, 1, 3).shape == (3,)


def test_provider_pairwise_bridge_journey(tmp_path):
    s = FileEmbeddingStore(tmp_path)
    for i, v in {"a": [1, 0, 0], "m": [0.7, 0.7, 0], "b": [0, 1, 0], "far": [0, 0, 1]}.items():
        s.put("effnet", i, v, {"model": "m", "modelVersion": "1"})
    p = sonic_mod.LocalEmbeddingProvider(s, sonic_mod.load_calibration(None))
    pw = p.pairwise(["a", "b", "nope"])
    assert pw["missing"] == ["nope"] and pw["raw"][0][1] == 0.0 and pw["raw"][0][0] == 1.0
    br = p.bridge("a", "b", ["m", "far"])
    assert br[0]["id"] == "m" and br[0]["between"] > br[1]["between"]
    assert [x["id"] for x in p.journey("a", "b", ["m", "far"], 1)] == ["m"]
    assert sonic_mod.ExternalDiscoveryProvider().configured is False


@pytest.mark.skipif(not sonic_mod.available(), reason="essentia-tensorflow not installed")
def test_embed_endpoint_real_model_and_cache(client):
    body = wav_bytes(make_track(124.0, seconds=30))
    r = client.post("/api/embed", files={"file": ("t.wav", body, "audio/wav")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["dims"] == 1280 and j["pooling"] == "mean" and j["topStyles"] and j["parents"] and isinstance(j["cached"], bool)
    assert client.post("/api/embed", files={"file": ("t.wav", body, "audio/wav")}).json()["cached"] is True
    pw = client.post("/api/sonic/pairwise", json={"ids": [j["id"]]}).json()
    assert pw["ids"] == [j["id"]] and abs(pw["raw"][0][0] - 1.0) < 1e-3
    assert client.get("/api/health").json()["sonic"]["available"] is True
