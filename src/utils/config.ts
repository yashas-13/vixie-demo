import { DemoStyle } from '../script/types.js';

export interface VixieConfig {
  url: string;
  output: string;
  voice: string;
  ttsProvider: 'kokoro' | 'edge' | 'openai' | 'elevenlabs';
  style: DemoStyle;
  cursor: 'animated' | 'none';
  rich: boolean;
  resolution: '720p' | '1080p' | '4K' | 'shorts720p' | 'shorts1080p';
  format: 'landscape' | 'shorts';
  maxPages: number;
  duration: number | 'auto';
  sections: string[] | 'all';
  backgroundMusic: string | null;
  dryRun: boolean;
  openaiApiKey: string | null;
  elevenlabsApiKey: string | null;
  resolutionDimensions: { width: number; height: number };
}

export const RESOLUTION_MAP = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
  'shorts720p': { width: 720, height: 1280 },
  'shorts1080p': { width: 1080, height: 1920 },
} as const;

function withDimensions(cfg: VixieConfig): VixieConfig {
  const dims = RESOLUTION_MAP[cfg.resolution];
  (cfg as VixieConfig).resolutionDimensions = { width: dims.width, height: dims.height };
  (cfg as VixieConfig).format = cfg.resolution.startsWith('shorts') ? 'shorts' : 'landscape';
  return cfg;
}

const BASE_CONFIG: Omit<VixieConfig, 'resolutionDimensions'> = {
  url: '',
  output: 'demo.mp4',
  voice: 'af_heart',
  ttsProvider: 'kokoro',
  style: 'professional',
  cursor: 'animated',
  rich: false,
  resolution: '1080p',
  format: 'landscape',
  maxPages: 3,
  duration: 'auto',
  sections: 'all',
  backgroundMusic: null,
  dryRun: false,
  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? null,
};

export const DEFAULT_CONFIG: VixieConfig = withDimensions(BASE_CONFIG as VixieConfig);

export function resolveConfig(overrides: Partial<VixieConfig>, url: string): VixieConfig {
  const cfg = { ...DEFAULT_CONFIG, ...overrides, url };
  return withDimensions(cfg);
}
