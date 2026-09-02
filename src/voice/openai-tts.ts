import OpenAI from 'openai';
import { writeFileSync } from 'fs';

export type OpenAIVoice = 'alloy' | 'ash' | 'ballad' | 'cedar' | 'coral' | 'echo' | 'fable' | 'marin' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';

export interface OpenAITTSConfig {
  voice: OpenAIVoice;
  model: 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';
  speed: number; // 0.25 to 4.0
  instructions: string; // gpt-4o-mini-tts only: tone, accent, pacing
  responseFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export const DEFAULT_OPENAI_TTS: OpenAITTSConfig = {
  voice: 'cedar',
  model: 'gpt-4o-mini-tts',
  speed: 1.0,
  instructions: 'Speak naturally and conversationally with a warm, professional tone. Vary pacing slightly and pause briefly after naming UI elements.',
  responseFormat: 'mp3',
};

export const OPENAI_VOICE_PRESETS: Record<string, Partial<OpenAITTSConfig>> = {
  'presales': {
    voice: 'cedar',
    model: 'gpt-4o-mini-tts',
    instructions: 'You are a confident technical sales engineer walking a prospect through a product demo. Speak clearly, warmly, and at a steady brisk pace with conversational energy. Pause briefly after naming each button or field so viewers can follow. Never sound monotone, rushed, or overly scripted.',
  },
  'professional-female': {
    voice: 'nova',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak with crisp professional diction and an approachable, confident tone.',
  },
  'warm-female': {
    voice: 'shimmer',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak warmly and gently, slightly slower than normal, with a soft friendly tone.',
  },
  'deep-male': {
    voice: 'onyx',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak with a deep, calm, authoritative voice at a measured pace.',
  },
  'friendly-male': {
    voice: 'echo',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak in an upbeat, friendly, approachable manner with natural enthusiasm.',
  },
  'storyteller': {
    voice: 'fable',
    model: 'gpt-4o-mini-tts',
    instructions: 'Tell the story with narrative warmth and expressive intonation, varying pace for emphasis.',
  },
  'calm': {
    voice: 'alloy',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak calmly and quietly at a relaxed pace with steady intonation.',
  },
  'energetic': {
    voice: 'ash',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak with high energy, brisk pace, and lively enthusiasm throughout.',
  },
  'narrator': {
    voice: 'ballad',
    model: 'gpt-4o-mini-tts',
    instructions: 'Narrate with a polished documentary voice: clear, resonant, and evenly paced.',
  },
};

export async function synthesizeWithOpenAI(
  text: string,
  outputPath: string,
  apiKey: string,
  config: Partial<OpenAITTSConfig> = {},
): Promise<{ outputPath: string; durationMs: number }> {
  const merged = { ...DEFAULT_OPENAI_TTS, ...config };
  const openai = new OpenAI({ apiKey });

  const params: Record<string, unknown> = {
    model: merged.model,
    voice: merged.voice,
    input: text,
    response_format: merged.responseFormat,
  };
  if (merged.model === 'gpt-4o-mini-tts') {
    params.instructions = merged.instructions;
  } else {
    params.speed = merged.speed;
  }

  const response = await openai.audio.speech.create(params as any);

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);

  const durationMs = Math.round((buffer.length / 16000) * 1000);

  return { outputPath, durationMs };
}

export function getOpenAIVoicePreset(name: string): Partial<OpenAITTSConfig> {
  return OPENAI_VOICE_PRESETS[name] ?? {};
}

export function listOpenAIVoices(): Array<{ name: string; id: OpenAIVoice }> {
  return [
    { name: 'Alloy', id: 'alloy' },
    { name: 'Ash', id: 'ash' },
    { name: 'Ballad', id: 'ballad' },
    { name: 'Cedar', id: 'cedar' },
    { name: 'Coral', id: 'coral' },
    { name: 'Echo', id: 'echo' },
    { name: 'Fable', id: 'fable' },
    { name: 'Marin', id: 'marin' },
    { name: 'Nova', id: 'nova' },
    { name: 'Onyx', id: 'onyx' },
    { name: 'Sage', id: 'sage' },
    { name: 'Shimmer', id: 'shimmer' },
    { name: 'Verse', id: 'verse' },
  ];
}
