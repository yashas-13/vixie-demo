import { Communicate } from 'edge-tts-universal';
import { writeFileSync } from 'fs';

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

export const VOICE_PRESETS: Record<string, Partial<EdgeTTSConfig>> = {
  'en-female-jenny': { voice: 'en-US-JennyNeural' },
  'en-female-aria': { voice: 'en-US-AriaNeural' },
  'en-male-guy': { voice: 'en-US-GuyNeural', pitch: '-2Hz' },
  'en-male-davis': { voice: 'en-US-DavisNeural', pitch: '-3Hz' },
  'en-female-sonia': { voice: 'en-GB-SoniaNeural' },
  'en-male-ryan': { voice: 'en-IE-RyanNeural', pitch: '-1Hz' },
  'en-india-prabhat': { voice: 'en-IN-PrabhatNeural', pitch: '-1Hz' },
  'en-australia-william': { voice: 'en-AU-WilliamNeural', pitch: '-2Hz' },
};

export async function synthesizeWithEdge(
  text: string,
  outputPath: string,
  config: Partial<EdgeTTSConfig> = {},
): Promise<{ outputPath: string; durationMs: number }> {
  const merged = { ...DEFAULT_EDGE_VOICE, ...config };

  const communicate = new Communicate(text, {
    voice: merged.voice,
    rate: merged.rate,
    pitch: merged.pitch,
    volume: merged.volume,
  });

  const audioChunks: Buffer[] = [];
  for await (const chunk of communicate.stream()) {
    if (chunk.type === 'audio' && chunk.data) {
      audioChunks.push(Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data));
    }
  }

  const audioBuffer = Buffer.concat(audioChunks);
  writeFileSync(outputPath, audioBuffer);

  const durationMs = Math.round((audioBuffer.length / 16000) * 1000);

  return { outputPath, durationMs };
}

export function getVoicePreset(presetName: string): Partial<EdgeTTSConfig> {
  return VOICE_PRESETS[presetName] ?? { voice: presetName };
}

export async function listEdgeVoices(): Promise<string[]> {
  return Object.keys(VOICE_PRESETS);
}
