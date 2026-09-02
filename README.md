# 🎬 Vixie

**AI-powered product demo video generator** — takes a URL and produces a professional MP4 demo video with AI narration, animated cursors, and visual annotations.


## Viewport / Scaling Fix (v1.0.1)

Fixed incorrect webpage rendering in captured videos:

- **Root cause:** crawler used `fullPage: true`, capturing the entire scrollable page (e.g. 1920×14804px) and cramming it into a 720p frame → tiny text and excessive whitespace.
- **Fix:** viewport-only capture at the configured resolution (`resolutionDimensions`), `deviceScaleFactor: 1`, no full-page screenshots. Text is naturally readable; responsive layout matches a native 1280×720 desktop viewport.
- **Regression test:** `test/viewport-scaling.mjs` (10 checks) verifies resolution config, output dimensions, and that annotation compositing preserves 1280×720 / 1920×1080.

```bash
npm test
```

Verified metrics during capture:

```
VIXIE CAPTURE METRICS: {"innerWidth":1280,"innerHeight":720,"outerWidth":1280,"outerHeight":720,
  "devicePixelRatio":1,"clientWidth":1280,"clientHeight":720,"scrollWidth":1280,"scrollHeight":720,
  "bodyZoom":"1","htmlZoom":"1"}
```

## Quick Start

```bash
# Install
npm install

# Set your OpenAI API key (for vision analysis)
export OPENAI_API_KEY=sk-...

# Generate a demo (free TTS, no ElevenLabs key needed)
npx tsx src/cli.ts generate https://your-app.com -o demo.mp4

# Quick mode with smart defaults
npx tsx src/cli.ts quick https://your-app.com

# List available voices
npx tsx src/cli.ts voices --provider edge
npx tsx src/cli.ts voices --provider openai
```

## How It Works (7-Stage Pipeline)

1. **🌐 Crawl** — Stagehand (AI browser) discovers pages and interactive elements
2. **🧠 Analyze** — GPT-4o Vision identifies features and annotation placement
3. **📝 Script** — AI generates a compelling narration script
4. **🎙️ Voice** — Dual TTS: edge-tts (free, 300+ voices) or OpenAI `gpt-4o-mini-tts` / ElevenLabs (premium); OpenAI presets drive tone, pacing, and accent via `instructions` (e.g. the `presales` preset)
5. **🔊 Mix** — Audio segments concatenated, normalized, optional background music
6. **🎨 Annotate** — Sharp + SVG compositing: arrows, highlights, glow, cursor overlay
7. **🎬 Compose** — FFmpeg (fast) or Remotion (rich) renders final 1080p MP4

Run `npx tsx src/cli.ts analyze demo.mp4` to verify the MP4 — it checks size, dimensions, duration, codec, audio, per-frame arrow/label/glow/cursor pixel analysis, and (auto-enabled with `OPENAI_API_KEY`) an AI vision QA pass that visually confirms every annotation graphic is present. Use `--no-vision` to skip the AI pass.

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output` | Output file path | `demo.mp4` |
| `--voice` | TTS voice name | `en-US-JennyNeural` |
| `--tts` | Provider: `edge`, `openai`, `elevenlabs` | `edge` |
| `--style` | `professional`, `casual`, `technical` | `professional` |
| `--cursor` | `animated` or `none` | `animated` |
| `--rich` | Use Remotion for rich composition | off |
| `--resolution` | `720p`, `1080p`, `4K` | `1080p` |
| `--max-pages` | Pages to crawl | `3` |
| `--duration` | Target seconds (`auto` or number) | `auto` |
| `--dry-run` | Preview script only | off |
| `--background-music` | Path to music file | none |

## API Server

```bash
npx tsx src/api/server.ts

# Endpoints:
# POST /api/generate     — Start generation (returns job ID)
# GET  /api/status/:id   — Poll progress
# GET  /api/download/:id — Download MP4
# POST /api/voices       — List voices
# GET  /api/preview/:id  — Preview script
```

## Web Dashboard

Start the server and open `http://localhost:3000` for a visual UI to configure and generate demos.

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── index.ts            # Main orchestrator (7-stage pipeline)
├── browser/
│   └── crawler.ts      # Stagehand AI browser crawling
├── analysis/
│   ├── types.ts        # Feature, annotation, UI element types
│   └── vision.ts       # GPT-4o Vision feature detection
├── script/
│   ├── types.ts        # Script segment types
│   └── generator.ts    # AI narration script generation
├── annotations/
│   └── compositor.ts   # Sharp + SVG annotation engine
├── voice/
│   ├── edge-tts.ts     # Free TTS (300+ Edge voices)
│   ├── openai-tts.ts   # Premium OpenAI TTS
│   ├── elevenlabs-tts.ts # Premium ElevenLabs TTS
│   └── mixer.ts        # Audio concatenation + mixing
├── video/
│   └── ffmpeg-composer.ts # FFmpeg video composition
├── api/
│   ├── server.ts       # Express REST API
│   └── routes.ts       # Dashboard routes
├── utils/
│   ├── config.ts       # Configuration + defaults
│   ├── bezier.ts       # Cursor animation paths
│   └── timing.ts       # Audio-visual sync
└── web/
    └── dashboard/
        └── index.html  # Web UI
```

## Tech Stack

- **Browser**: Stagehand (AI-native Playwright)
- **Vision**: OpenAI GPT-4o
- **Voice Free**: edge-tts-universal (Microsoft Edge TTS, no API key)
- **Voice Premium**: OpenAI TTS + ElevenLabs
- **Annotations**: Sharp + SVG compositing
- **Video**: FFmpeg (fast path) / Remotion (rich path)
- **Cursor**: Bezier curve animation via CDP
- **API**: Express + TypeScript
