import express from 'express';
import { resolveConfig, type VixieConfig } from '../utils/config.js';
import { generateDemo } from '../index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

interface Job {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  config: VixieConfig;
  outputPath?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  segments?: number;
}

const jobs = new Map<string, Job>();

// ── POST /api/generate — Start demo generation ────────
app.post('/api/generate', async (req, res) => {
  const { url, output, voice, tts, style, cursor, rich, resolution, maxPages, duration, backgroundMusic } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const jobId = randomUUID();
  const config = resolveConfig({
    output: output ?? `demos/${jobId}.mp4`,
    voice: voice ?? 'en-US-JennyNeural',
    ttsProvider: tts ?? 'edge',
    style: style ?? 'professional',
    cursor: cursor ?? 'animated',
    rich: rich ?? false,
    resolution: resolution ?? '1080p',
    maxPages: maxPages ?? 3,
    duration: duration ?? 'auto',
    sections: 'all',
    backgroundMusic: backgroundMusic ?? null,
  }, url);

  const job: Job = {
    id: jobId,
    status: 'running',
    config,
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  // Run generation in background
  generateDemo(config)
    .then((result) => {
      job.status = 'completed';
      job.outputPath = result.outputPath;
      job.completedAt = new Date().toISOString();
      job.segments = result.segments;
    })
    .catch((err) => {
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
    });

  return res.json({ jobId, status: 'running' });
});

// ── GET /api/status/:jobId — Check job progress ───────
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.json({
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    outputPath: job.outputPath,
    error: job.error,
    segments: job.segments,
  });
});

// ── GET /api/download/:jobId — Download completed video
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'completed' || !job.outputPath) {
    return res.status(400).json({ error: 'Video not ready' });
  }
  if (!existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  return res.download(job.outputPath);
});

// ── GET /api/preview/:jobId — Preview script + annotations
app.get('/api/preview/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Try to load the generated script
  const scriptPath = job.config.output.replace(/\.[^.]+$/, '') + '_vixie/script.json';
  if (existsSync(scriptPath)) {
    const script = JSON.parse(readFileSync(scriptPath, 'utf-8'));
    return res.json(script);
  }

  return res.json({ status: job.status, message: 'Script not yet available' });
});

// ── POST /api/voices — List available voices ──────────
app.post('/api/voices', async (req, res) => {
  const { provider = 'edge' } = req.body;

  if (provider === 'edge') {
    const { listEdgeVoices } = await import('../voice/edge-tts.js');
    const voices = await listEdgeVoices();
    return res.json({ provider, voices });
  } else if (provider === 'openai') {
    const { listOpenAIVoices } = await import('../voice/openai-tts.js');
    const voices = listOpenAIVoices();
    return res.json({ provider, voices });
  }

  return res.status(400).json({ error: 'Unknown provider' });
});

// ── DELETE /api/cancel/:jobId — Cancel a job ──────────
app.delete('/api/cancel/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  job.status = 'failed';
  job.error = 'Cancelled by user';
  job.completedAt = new Date().toISOString();
  return res.json({ id: job.id, status: 'cancelled' });
});

export async function startServer(port: number = 3000): Promise<void> {
  app.listen(port, () => {
    console.log(`\n🎬 Vixie API Server running on http://localhost:${port}`);
    console.log(`   POST /api/generate    — Start demo generation`);
    console.log(`   GET  /api/status/:id  — Check job progress`);
    console.log(`   GET  /api/download/:id — Download video`);
    console.log(`   POST /api/voices      — List voices`);
    console.log(`   GET  /api/preview/:id  — Preview script`);
  });
}
