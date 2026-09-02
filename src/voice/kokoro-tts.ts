/**
 * Kokoro TTS — local neural voice synthesis using Kokoro-82M via Python bridge.
 * Produces remarkably human-like voices without any API key.
 */
import { execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';

const KOKORO_PYTHON = '/root/tts-venv/bin/python3';
const KOKORO_SCRIPT = new URL('./kokoro_tts.py', import.meta.url).pathname;

export interface KokoroTTSConfig {
  voice: string;
  speed: number;
  outputFormat: 'wav';
}

export const DEFAULT_KOKORO_TTS: KokoroTTSConfig = {
  voice: 'af_heart',
  speed: 1.0,
  outputFormat: 'wav',
};

export const KOKORO_VOICE_PRESETS: Record<string, Partial<KokoroTTSConfig>> = {
  'heart':   { voice: 'af_heart' },
  'bella':   { voice: 'af_bella' },
  'nicole':  { voice: 'af_nicole' },
  'aoede':   { voice: 'af_aoede' },
  'kore':    { voice: 'af_kore' },
  'sarah':   { voice: 'af_sarah' },
  'sky':     { voice: 'af_sky' },
  'michael': { voice: 'am_michael' },
  'fenrir':  { voice: 'am_fenrir' },
  'puck':    { voice: 'am_puck' },
  'liam':    { voice: 'am_liam' },
  'onyx':    { voice: 'am_onyx' },
  'emma-gb': { voice: 'bf_emma' },
  'fable':   { voice: 'bm_fable' },
  'george':  { voice: 'bm_george' },
};

export async function synthesizeWithKokoro(
  text: string,
  outputPath: string,
  config: Partial<KokoroTTSConfig> = {},
): Promise<{ outputPath: string; durationMs: number }> {
  const merged = { ...DEFAULT_KOKORO_TTS, ...config };
  const wavOutput = outputPath.replace(/\.(mp3|wav)$/, '.wav');
  const finalOutput = outputPath;

  if (!existsSync(KOKORO_PYTHON) || !existsSync(KOKORO_SCRIPT)) {
    throw new Error(`Kokoro not available: ${KOKORO_PYTHON} + ${KOKORO_SCRIPT}`);
  }

  // Write config as temp file to avoid shell escaping issues
  const tmpConfig = `/tmp/vixie-kokoro-${Date.now()}.json`;
  writeFileSync(tmpConfig, JSON.stringify({
    text,
    voice: merged.voice,
    speed: merged.speed,
    output: wavOutput,
  }), 'utf-8');

  try {
    const result = execSync(
      `cat "${tmpConfig}" | "${KOKORO_PYTHON}" "${KOKORO_SCRIPT}"`,
      {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120_000,
        env: {
          ...process.env,
          HF_HUB_DISABLE_TELEMETRY: '1',
          HF_HUB_DISABLE_PROGRESS_BARS: '1',
        },
      },
    );

    const lastLine = result.trim().split('\n').pop() ?? '{}';
    const parsed = JSON.parse(lastLine);

    if (!parsed.ok) {
      throw new Error(`Kokoro TTS failed: ${lastLine}`);
    }

    const durationMs = Math.round(parsed.duration_s * 1000);

    // Convert WAV → MP3 for consistency
    if (finalOutput.endsWith('.mp3')) {
      execSync(
        `ffmpeg -y -i "${wavOutput}" -codec:a libmp3lame -q:a 2 "${finalOutput}" 2>/dev/null`,
        { stdio: 'pipe' },
      );
    }

    return { outputPath: finalOutput, durationMs };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    throw new Error(`Kokoro TTS failed: ${msg.slice(0, 200)}`);
  } finally {
    try { unlinkSync(tmpConfig); } catch {}
  }
}

export function getKokoroVoicePreset(name: string): Partial<KokoroTTSConfig> {
  return KOKORO_VOICE_PRESETS[name] ?? { voice: name };
}

export function listKokoroVoices(): Array<{ id: string; label: string }> {
  return Object.entries(KOKORO_VOICE_PRESETS).map(([id, cfg]) => ({
    id,
    label: cfg.voice!,
  }));
}
