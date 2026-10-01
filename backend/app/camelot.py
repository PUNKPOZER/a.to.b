"""Deterministic (key, scale) -> Camelot. Never guessed by a model."""
FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E"}
CAMELOT = {
    "A_minor": "8A", "C_major": "8B", "E_minor": "9A", "G_major": "9B", "B_minor": "10A", "D_major": "10B",
    "F#_minor": "11A", "A_major": "11B", "C#_minor": "12A", "E_major": "12B", "G#_minor": "1A", "B_major": "1B",
    "D#_minor": "2A", "F#_major": "2B", "A#_minor": "3A", "C#_major": "3B", "F_minor": "4A", "G#_major": "4B",
    "C_minor": "5A", "D#_major": "5B", "G_minor": "6A", "A#_major": "6B", "D_minor": "7A", "F_major": "7B",
}


def to_camelot(key: str, scale: str) -> str | None:
    tonic = FLAT_TO_SHARP.get(key, key)
    return CAMELOT.get(f"{tonic}_{'major' if scale.lower().startswith('maj') else 'minor'}")


def normalize_key(key: str) -> str:
    return FLAT_TO_SHARP.get(key, key)
