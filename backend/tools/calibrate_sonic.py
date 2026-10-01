"""Build app/sonic_calibration.json from a folder of reference audio (local files only, nothing is uploaded).
Usage: python tools/calibrate_sonic.py <folder> [max_tracks]   (run from backend/)"""
import json, sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, ".")
from app import sonic
from app.decode import decode_mono

folder, n = Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 40
files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in (".mp3", ".wav", ".flac", ".m4a") and p.stat().st_size > 1_000_000)
step = max(1, len(files) // n)
files = files[::step][:n]
vecs, timings = [], []
for f in files:
    t = time.time()
    try:
        r = sonic.embed(decode_mono(str(f), sonic.SAMPLE_RATE, sonic.MAX_SECONDS))
    except Exception as e:  # noqa: BLE001
        print("skip", f.name, e); continue
    vecs.append(r["vector"]); timings.append((time.time() - t, len(r["frames"])))
    print(f"{f.name[:50]:50s} {time.time()-t:5.1f}s frames={r['frameCount']} top={r['topStyles'][0]['label']}", flush=True)
cal = sonic.build_calibration(vecs, f"{len(vecs)} tracks from the developer's local DJ folders")
Path("app/sonic_calibration.json").write_text(json.dumps(cal, indent=1))
print(json.dumps({k: cal[k] for k in ("tracks", "pairs", "rawQuantiles")}))
print("mean secs/track", np.mean([t for t, _ in timings]))
