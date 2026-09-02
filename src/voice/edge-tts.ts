import { Communicate } from 'edge-tts-universal';
import { writeFileSync } from 'fs';
import { applyProsody, enhanceIntroOutro, type ProsodyOptions } from './prosody.js';

export interface EdgeTTSConfig {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
}

export const DEFAULT_EDGE_VOICE: EdgeTTSConfig = {
  voice: 'en-US-JennyNeural',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
};

/**
 * Voice presets optimized for emotional, human-like narration.
 * Voice choices are based on personality traits:
 * - JennyNeural: Warm, professional, versatile
 * - AriaNeural: Friendly, expressive, approachable
 * - GuyNeural: Deep, confident, authoritative
 * - DavisNeural: Smooth, energetic, charismatic
 * - SoniaNeural: Elegant, clear, British warmth
 * - RyanNeural: Conversational, warm Irish
 * - EmmaMultilingualNeural: Multilingual, bright
 * - MichelleNeural: Young, energetic, casual
 */
export const VOICE_PRESETS: Record<string, Partial<EdgeTTSConfig>> = {
  // Expressive female voices
  'en-female-jenny':   { voice: 'en-US-JennyNeural' },
  'en-female-aria':    { voice: 'en-US-AriaNeural' },
  'en-female-emma':    { voice: 'en-US-EmmaMultilingualNeural' },
  'en-female-michelle':{ voice: 'en-US-MichelleNeural' },
  // Expressive male voices
  'en-male-guy':       { voice: 'en-US-GuyNeural' },
  'en-male-davis':     { voice: 'en-US-DavisNeural' },
  'en-male-andrew':    { voice: 'en-US-AndrewNeural' },
  'en-male-brian':     { voice: 'en-US-BrianNeural' },
  // British / international warmth
  'en-female-sonia':   { voice: 'en-GB-SoniaNeural' },
  'en-male-ryan':      { voice: 'en-IE-RyanNeural' },
  'en-india-prabhat':  { voice: 'en-IN-PrabhatNeural' },
  'en-australia-william': { voice: 'en-AU-WilliamNeural' },
};

export async function synthesizeWithEdge(
  text: string,
  outputPath: string,
  config: Partial<EdgeTTSConfig> = {},
  prosody: Partial<ProsodyOptions> = {},
): Promise<{ outputPath: string; durationMs: number }> {
  const merged = { ...DEFAULT_EDGE_VOICE, ...config };

  // Apply emotional prosody — split into per-sentence chunks with varied rate/pitch
  const emotion = prosody.emotion ?? 'warm';
  const chunks = applyProsody(text, {
    baseRate: merged.rate,
    basePitch: merged.pitch,
    baseVolume: merged.volume,
    emotion,
  });

  // Synthesize each prosody chunk with its own rate/pitch, then concatenate
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    // Skip pause/empty chunks (pure silence) — no text to synthesize
    const chunkText = chunk.text.trim();
    const hasReadableWords = /[a-zA-Z0-9]/.test(chunkText);
    if (!hasReadableWords || chunkText.length <= 1) {
      // Generate ~200ms natural breathing silence using ffmpeg
      try {
        const { execSync } = await import('child_process');
        const silenceBuf = execSync(
          `ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 0.2 -c:a libmp3lame -q:a 9 -b:a 16k pipe:1`,
          { encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        audioBuffers.push(Buffer.from(silenceBuf as Buffer));
      } catch { /* skip silence if ffmpeg fails */ }
      continue;
    }

    const communicate = new Communicate(chunk.text, {
      voice: merged.voice,
      rate: chunk.rate,
      pitch: chunk.pitch,
      volume: chunk.volume,
    });

    for await (const c of communicate.stream()) {
      if (c.type === 'audio' && c.data) {
        audioBuffers.push(Buffer.isBuffer(c.data) ? c.data : Buffer.from(c.data));
      }
    }
  }

  const audioBuffer = Buffer.concat(audioBuffers);
  writeFileSync(outputPath, audioBuffer);

  // Duration estimate based on MP3 bitrate (24kHz mono = ~32kbps typical)
  const durationMs = Math.round((audioBuffer.length / (24000 * 0.02)) * 1000 / 1000);

  return { outputPath, durationMs };
}

export function getVoicePreset(presetName: string): Partial<EdgeTTSConfig> {
  return VOICE_PRESETS[presetName] ?? { voice: presetName };
}

export async function listEdgeVoices(): Promise<string[]> {
  return Object.keys(VOICE_PRESETS);
}
