"""Discogs-EffNet through ONNX Runtime — the portable path (Windows, Linux, Intel Mac) where essentia-tensorflow is not available.

Reproduces Essentia's `TensorflowPredictEffnetDiscogs` front-end in numpy (verified against Essentia on real audio):
16 kHz mono -> frames of 512 (hop 256, first frame centred) -> symmetric Hann -> power spectrum -> 96 Slaney-mel triangles
(0-8 kHz, area-normalised) -> log10(1 + 10000 x) -> patches of 128 frames, hop 62 -> official ONNX model
(`discogs-effnet-bsdynamic-1.onnx`) -> per-patch 1280-d embedding + 400 style activations."""
from __future__ import annotations

import numpy as np

SR, FRAME, HOP, BANDS = 16000, 512, 256, 96
PATCH, PATCH_HOP, BATCH = 128, 62, 64


def _hz2mel(f):
    f = np.asarray(f, float)
    return np.where(f >= 1000, 15 + np.log(np.maximum(f, 1e-9) / 1000) / (np.log(6.4) / 27), f / (200 / 3))


def _mel2hz(m):
    m = np.asarray(m, float)
    return np.where(m >= 15, 1000 * np.exp((np.log(6.4) / 27) * (m - 15)), m * (200 / 3))


def mel_filterbank() -> np.ndarray:
    pts = _mel2hz(np.linspace(_hz2mel(0.0), _hz2mel(SR / 2), BANDS + 2))
    freqs = np.arange(FRAME // 2 + 1) * SR / FRAME
    fb = np.zeros((BANDS, len(freqs)))
    for i in range(BANDS):
        lo, c, hi = pts[i], pts[i + 1], pts[i + 2]
        fb[i] = np.maximum(0, np.minimum((freqs - lo) / (c - lo), (hi - freqs) / (hi - c))) * (2.0 / (hi - lo))
    return fb.astype(np.float32)


_FB = mel_filterbank()
_WIN = np.hanning(FRAME).astype(np.float32)


def log_mel(audio: np.ndarray) -> np.ndarray:
    """(n_frames, 96) log-compressed mel bands, framing identical to Essentia's FrameCutter defaults."""
    x = np.concatenate([np.zeros(FRAME // 2, np.float32), np.asarray(audio, np.float32)])
    n = 1 + (len(x) - FRAME) // HOP + (1 if (len(x) - FRAME) % HOP else 0)
    x = np.concatenate([x, np.zeros(max(0, (n - 1) * HOP + FRAME - len(x)), np.float32)])
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(x[idx] * _WIN, axis=1)) ** 2
    return np.log10(10000.0 * (spec @ _FB.T) + 1.0).astype(np.float32)


def patches(mel: np.ndarray) -> np.ndarray:
    starts = range(0, mel.shape[0] - PATCH + 1, PATCH_HOP)  # incomplete last patch is discarded, as in Essentia
    return np.stack([mel[s:s + PATCH] for s in starts]) if len(starts) else np.zeros((0, PATCH, BANDS), np.float32)


class EffnetOnnx:
    def __init__(self, model_path: str):
        import onnxruntime as ort
        so = ort.SessionOptions(); so.log_severity_level = 3
        self.sess = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        names = [o.name for o in self.sess.get_outputs()]
        self.pred_name = "PartitionedCall:0" if "PartitionedCall:0" in names else names[0]
        self.emb_name = "PartitionedCall:1" if "PartitionedCall:1" in names else names[1]

    def run(self, audio16k: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """-> (embeddings [n,1280], predictions [n,400]) per patch (~1 s each)."""
        p = patches(log_mel(audio16k))
        if not len(p):
            return np.zeros((0, 1280), np.float32), np.zeros((0, 400), np.float32)
        embs, preds = [], []
        for i in range(0, len(p), BATCH):
            pr, em = self.sess.run([self.pred_name, self.emb_name], {self.inp: p[i:i + BATCH]})
            preds.append(pr); embs.append(em)
        return np.concatenate(embs).astype(np.float32), np.concatenate(preds).astype(np.float32)
