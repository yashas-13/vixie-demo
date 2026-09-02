#!/usr/bin/env python3
"""Kokoro TTS bridge — called by Node.js via subprocess.
Reads JSON config from stdin, synthesizes with Kokoro, writes WAV output.

Usage:
  echo '{"text":"Hello world","voice":"af_bella","speed":1.0,"output":"/tmp/out.wav"}' \
    | python3 kokoro_tts.py
"""
import sys
import json
import numpy as np
import soundfile as sf
from kokoro import KPipeline

def main():
    config = json.load(sys.stdin)
    text = config.get("text", "")
    voice = config.get("voice", "af_bella")
    speed = float(config.get("speed", 1.0))
    output = config.get("output", "/tmp/kokoro_out.wav")

    # Determine lang_code from voice prefix: af_ -> 'a', bf_ -> 'b', etc.
    lang_code = voice[0] if voice and voice[1] == '_' else 'a'

    pipeline = KPipeline(lang_code=lang_code)

    # Generate audio — the pipeline returns (graphemes, phonemes, audio) per chunk
    chunks = []
    for gs, ps, audio in pipeline(text, voice=voice, speed=speed):
        if audio is not None and len(audio) > 0:
            chunks.append(audio.detach().cpu().numpy() if hasattr(audio, 'detach') else audio)

    if not chunks:
        # Write empty audio (100ms silence)
        audio_np = np.zeros(int(24000 * 0.1), dtype=np.float32)
    else:
        audio_np = np.concatenate(chunks).astype(np.float32)

    sf.write(output, audio_np, 24000)
    print(json.dumps({
        "ok": True,
        "output": output,
        "duration_s": round(len(audio_np) / 24000, 3),
        "sample_rate": 24000,
        "voice": voice,
    }))

if __name__ == "__main__":
    main()
