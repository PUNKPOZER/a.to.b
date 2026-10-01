"""Audio decoding through the system ffmpeg (any format ffmpeg knows)."""
import os
import re
import shutil
import subprocess
import numpy as np

SR = 44100
FFMPEG = os.getenv("SELECTOR_FFMPEG") or "ffmpeg"  # the desktop app points this at its bundled binary


def ffmpeg_available() -> bool:
    return bool(shutil.which(FFMPEG) or os.path.isfile(FFMPEG))


class DecodeError(Exception):
    pass


def decode_stereo(path: str, max_seconds: float) -> np.ndarray:
    """Decode to float32 stereo @44.1 kHz, shape (n, 2), first `max_seconds` only.
    The path is passed as a single argv element (no shell)."""
    cmd = [FFMPEG, "-v", "error", "-nostdin", "-i", path, "-t", str(max_seconds),
           "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "pipe:1"]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=180)
    except FileNotFoundError as e:
        raise DecodeError("ffmpeg is not installed") from e
    except subprocess.TimeoutExpired as e:
        raise DecodeError("decoding timed out") from e
    if p.returncode != 0 or len(p.stdout) < SR * 2 * 4:  # < 1 s of audio
        raise DecodeError("could not decode audio: " + p.stderr.decode("utf-8", "replace")[:200])
    n = len(p.stdout) // 8
    return np.frombuffer(p.stdout[: n * 8], dtype=np.float32).reshape(n, 2)


def duration_seconds(path: str) -> float | None:
    """Duration from the `Duration: HH:MM:SS.xx` line of `ffmpeg -i` (no ffprobe needed)."""
    try:
        err = subprocess.run([FFMPEG, "-nostdin", "-i", path], capture_output=True, timeout=30).stderr.decode("utf-8", "replace")
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None
    except Exception:
        return None



def decode_mono(path: str, sr: int, max_seconds: float) -> np.ndarray:
    """Decode to float32 mono at an arbitrary rate (16 kHz for Discogs-EffNet)."""
    cmd = [FFMPEG, "-v", "error", "-nostdin", "-i", path, "-t", str(max_seconds),
           "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=180)
    except FileNotFoundError as e:
        raise DecodeError("ffmpeg is not installed") from e
    except subprocess.TimeoutExpired as e:
        raise DecodeError("decoding timed out") from e
    if p.returncode != 0 or len(p.stdout) < sr * 4:
        raise DecodeError("could not decode audio: " + p.stderr.decode("utf-8", "replace")[:200])
    return np.frombuffer(p.stdout[: len(p.stdout) // 4 * 4], dtype=np.float32)
