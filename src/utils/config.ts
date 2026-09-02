import { DemoStyle } from '../script/types.js';

export interface VixieConfig {
  url: string;
  output: string;
  voice: string;
  ttsProvider: 'edge' | 'openai' | 'elevenlabs';
  style: DemoStyle;
  cursor: 'animated' | 'none';
  rich: boolean;
  resolution: '720p' | '1080p' | '4K';
  maxPages: number;
  duration: number | 'auto';
  sections: string[] | 'all';
  backgroundMusic: string | null;
  dryRun: boolean;
  openaiApiKey: string | null;
  elevenlabsApiKey: string | null;
}

export const DEFAULT_CONFIG: VixieConfig = {
  url: '',
  output: 'demo.mp4',
  voice: 'en-US-JennyNeural',
  ttsProvider: 'edge',
  style: 'professional',
  cursor: 'animated',
  rich: false,
  resolution: '1080p',
  maxPages: 3,
  duration: 'auto',
  sections: 'all',
  backgroundMusic: null,
  dryRun: false,
  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? null,
};

export const RESOLUTION_MAP = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
} as const;

export function resolveConfig(overrides: Partial<VixieConfig>, url: string): VixieConfig {
  return { ...DEFAULT_CONFIG, ...overrides, url };
}
