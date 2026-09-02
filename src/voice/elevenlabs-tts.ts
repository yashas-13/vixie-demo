import { writeFileSync } from 'fs';

export interface ElevenLabsConfig {
  voiceId: string;
  modelId: string;
  stability: number;       // 0.0 - 1.0
  similarityBoost: number; // 0.0 - 1.0
  style: number;           // 0.0 - 1.0
  speed: number;           // 0.75 - 1.25
}

export const DEFAULT_ELEVENLABS: ElevenLabsConfig = {
  voiceId: 'JBFqnCBsd6RMkjVDRZzb', // "George" - narrator voice
  modelId: 'eleven_turbo_v2_5',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.3,
  speed: 1.0,
};

export const ELEVENLABS_PRESETS: Record<string, Partial<ElevenLabsConfig>> = {
  narrator: { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.6, similarityBoost: 0.8, style: 0.2 },
  friendly: { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.4, similarityBoost: 0.7, style: 0.5 },
  professional: { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.7, similarityBoost: 0.8, style: 0.1 },
};

export async function synthesizeWithElevenLabs(
  text: string,
  outputPath: string,
  apiKey: string,
  config: Partial<ElevenLabsConfig> = {},
): Promise<{ outputPath: string; durationMs: number }> {
  const merged = { ...DEFAULT_ELEVENLABS, ...config };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${merged.voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: merged.modelId,
      voice_settings: {
        stability: merged.stability,
        similarity_boost: merged.similarityBoost,
        style: merged.style,
        speed: merged.speed,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  writeFileSync(outputPath, buffer);

  const durationMs = Math.round((buffer.length / 16000) * 1000);

  return { outputPath, durationMs };
}

export function getElevenLabsPreset(name: string): Partial<ElevenLabsConfig> {
  return ELEVENLABS_PRESETS[name] ?? {};
}
