"""All-In-One structure analysis worker (runs inside structure/.venv, called by the API as a subprocess).
Usage: run_allin1.py <audio> <out.json>
Output JSON: bpm, beats, downbeats, beatPositions, segments[{start,end,label,energyDb}], embedding (mean vector), model info.
Everything here comes straight from the all-in-one-mlx result; nothing is invented."""
import json
import sys
import tempfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")


def main(audio: str, out_json: str) -> None:
    import numpy as np
    import allin1_mlx
    import librosa

    with tempfile.TemporaryDirectory(prefix="sel_a1_") as tmp:
        t = Path(tmp)
        r = allin1_mlx.analyze(audio, out_dir=str(t / "o"), demix_dir=str(t / "demix"), spec_dir=str(t / "spec"),
                               multiprocess=False, keep_byproducts=False, include_embeddings=True)
    # mean RMS (dB) of every section, from the audio itself — used for energy-change detection
    y, sr = librosa.load(audio, sr=22050, mono=True)
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    segs = []
    for s in r.segments:
        m = (times >= float(s.start)) & (times < float(s.end))
        e = float(np.mean(rms[m])) if m.any() else 0.0
        segs.append({"start": round(float(s.start), 3), "end": round(float(s.end), 3), "label": str(s.label),
                     "energyDb": round(20 * float(np.log10(e + 1e-9)), 2)})
    emb = None
    if r.embeddings is not None:
        a = np.asarray(r.embeddings, dtype=np.float32)  # (models, frames, 24, 8)
        emb = [round(float(x), 5) for x in a.mean(axis=1).reshape(-1)]
    out = {
        "analyzer": {"name": "all-in-one-mlx", "version": allin1_mlx.__version__, "model": "harmonix-all"},
        "bpm": float(r.bpm),
        "beats": [round(float(x), 3) for x in r.beats],
        "downbeats": [round(float(x), 3) for x in r.downbeats],
        "beatPositions": [int(x) for x in r.beat_positions],
        "segments": segs,
        "embedding": emb,
    }
    Path(out_json).write_text(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
