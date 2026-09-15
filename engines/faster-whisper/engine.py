import base64
import json
import os
import sys
import tempfile
import traceback
from faster_whisper import WhisperModel

# Frozen Windows executables do not inherit Python's UTF-8 mode reliably.
# The Node parent speaks UTF-8 JSON, including Korean prompts and transcripts.
sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MODEL = os.environ.get("FW_MODEL", "small")
DEVICE = os.environ.get("FW_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("FW_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.environ.get("FW_CPU_THREADS", "6"))
BEAM_SIZE = int(os.environ.get("FW_BEAM_SIZE", "3"))

model = None
history = []
MAX_PROMPT_CHARS = 700


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_model():
    global model
    if model is None:
        emit({"type": "status", "status": "loading", "model": MODEL, "device": DEVICE, "compute_type": COMPUTE_TYPE})
        model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
        emit({"type": "status", "status": "ready", "model": MODEL, "device": DEVICE, "compute_type": COMPUTE_TYPE})
    return model


def prompt_text(extra=""):
    text = " ".join(history[-12:])
    if extra:
        text = (text + " " + extra).strip()
    return text[-MAX_PROMPT_CHARS:]


def transcribe(req):
    audio_b64 = req.get("audioBase64")
    if not audio_b64:
        return {"id": req.get("id"), "error": "missing audioBase64"}

    language = req.get("language") or "ko"
    initial_prompt = req.get("prompt") or ""
    audio_bytes = base64.b64decode(audio_b64)
    suffix = ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        m = load_model()
        segments, info = m.transcribe(
            tmp_path,
            language=language,
            task="transcribe",
            beam_size=BEAM_SIZE,
            best_of=BEAM_SIZE,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 450,
                "speech_pad_ms": 250,
            },
            condition_on_previous_text=True,
            initial_prompt=prompt_text(initial_prompt),
            without_timestamps=False,
            word_timestamps=False,
        )
        items = []
        for seg in segments:
            text = (seg.text or "").strip()
            if text:
                items.append({"start": seg.start, "end": seg.end, "text": text})
        text = " ".join(item["text"] for item in items).strip()
        if text:
            history.append(text)
            del history[:-30]
        return {
            "id": req.get("id"),
            "text": text,
            "segments": items,
            "language": getattr(info, "language", language),
            "duration": getattr(info, "duration", None),
            "engine": "faster-whisper",
            "model": MODEL,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def main():
    load_model()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            if req.get("command") == "reset":
                history.clear()
                emit({"id": req.get("id"), "ok": True})
            elif req.get("command") == "ping":
                emit({"id": req.get("id"), "ok": True, "engine": "faster-whisper", "model": MODEL})
            else:
                emit(transcribe(req))
        except Exception as exc:
            emit({"id": req.get("id"), "error": str(exc), "traceback": traceback.format_exc()})


if __name__ == "__main__":
    main()
