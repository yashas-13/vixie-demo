# Vixie

AI-powered product demo video generator — a URL to a professional MP4 with voiceover, annotation overlays, and automated video analysis.

## Overview

Vixie crawls a web app, captures annotated screenshots, generates a human-like voiceover script, narrates it, and stitches everything into a polished `.mp4` — like a technical product pre-sales demo. An AI vision analyzer then verifies the output (arrow/label/glow markers, codec, scene transitions, audio).

## Features

- **URL → narrated MP4** end-to-end pipeline
- **Annotation overlays** — arrow boxes, label chips, glow markers, dimmed backgrounds
- **Human-like TTS** — OpenAI `gpt-4o-mini-tts` (`presales` voice preset) + edge-tts + ElevenLabs
- **AI vision QA** — GPT-4o-mini multimodal verification of annotation graphics
- **Video analyzer** — codec, dimensions, fps, audio, scene-transition checks (96/100 pass)

## Getting started

```bash
npm install
npm run build        # compile TypeScript
npm run dev -- --help   # CLI
```

Copy `.env.example` → `.env` and set `OPENAI_API_KEY` for OpenAI TTS + vision QA.

## Usage

```bash
# Generate a narrated annotated demo of a website
vixie generate https://example.com --tts openai --voice presales

# Use free edge-tts narration
vixie generate https://example.com --tts edge --voice en-US-AvaNeural

# Analyze an existing output video (with AI vision QA when OPENAI_API_KEY is set)
npx tsx src/cli.ts analyze output.mp4
```

## Source layout

```
src/
├── analysis/     # vision types + multimodal AI verification
├── annotations/  # overlay compositor (arrows, labels, glow)
├── api/          # express server + routes
├── browser/      # playwright-based crawler
├── script/       # narration script generation
├── utils/        # bezier curves, config, timing
├── video/        # ffmpeg composer + analyzer
├── voice/        # openai / edge / elevenlabs TTS + mixer
└── web/dashboard # web dashboard
```

## Sample output

See `demo/report.txt` for a full 96/100 analyzer report on `stripe-v3-narrated.mp4` (1280×720, H.264, drama-human narration).

## License

MIT
