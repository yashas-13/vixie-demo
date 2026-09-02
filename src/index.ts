import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import ora from 'ora';
import chalk from 'chalk';

import type { VixieConfig } from './utils/config.js';
import { RESOLUTION_MAP } from './utils/config.js';
import { crawlWebsite } from './browser/crawler.js';
import { analyzeWithVision } from './analysis/vision.js';
import { generateScript } from './script/generator.js';
import { annotateFrame } from './annotations/compositor.js';
import { synthesizeWithEdge, getVoicePreset } from './voice/edge-tts.js';
import { synthesizeWithKokoro, getKokoroVoicePreset } from './voice/kokoro-tts.js';
import { synthesizeWithOpenAI, getOpenAIVoicePreset } from './voice/openai-tts.js';
import { synthesizeWithElevenLabs, getElevenLabsPreset } from './voice/elevenlabs-tts.js';
import { concatAudioSegments, mixWithBackgroundMusic, normalizeAudio, type AudioSegment } from './voice/mixer.js';
import { composeWithFfmpeg } from './video/ffmpeg-composer.js';
import { composeShortsVideo } from './video/shorts-composer.js';

export interface GenerateResult {
  outputPath: string;
  durationMs: number;
  segments: number;
}

export async function generateDemo(config: VixieConfig): Promise<GenerateResult> {
  const startTime = Date.now();
  const outputDir = join(config.output.replace(/\.[^.]+$/, '') + '_vixie');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  mkdirSync(join(outputDir, 'annotated'), { recursive: true });
  mkdirSync(join(outputDir, 'audio'), { recursive: true });

  const resolution = RESOLUTION_MAP[config.resolution];

  // ── Stage 1: Crawl ──────────────────────────────────────
  const spinner = ora('🌐 Crawling website with Stagehand...').start();
  const crawlResult = await crawlWebsite(config, outputDir);
  spinner.succeed(`Crawled ${crawlResult.manifest.pages.length} pages`);

  // ── Stage 2: Analyze with Vision ────────────────────────
  spinner.start('🧠 Analyzing features with GPT-4o Vision...');
  const allFeatures: any[] = [];
  const allAnnotations: any[] = [];

  for (const [key, screenshotBuffer] of crawlResult.screenshots) {
    const pageInfo = crawlResult.manifest.pages.find(
      (p: any) => p.screenshotPath.includes(key),
    );
    if (!pageInfo) continue;

    if (config.openaiApiKey) {
      const analysis = await analyzeWithVision(
        {
          screenshotBuffer,
          elements: pageInfo.elements,
          pageUrl: pageInfo.url,
          pageTitle: pageInfo.title,
        },
        config.openaiApiKey,
      );
      allFeatures.push(...analysis.features);
      allAnnotations.push(...analysis.annotations);
    } else {
      // Fallback: use DOM-detected elements as features
      allFeatures.push(...pageInfo.elements.map((el: any, i: number) => ({
        id: `${key}-${i}`,
        pageUrl: pageInfo.url,
        pageTitle: pageInfo.title,
        element: el,
        category: el.role,
        description: el.text,
        screenshotPath: pageInfo.screenshotPath,
      })));
    }
  }
  spinner.succeed(`Identified ${allFeatures.length} features`);

  // ── Stage 3: Generate Script ────────────────────────────
  spinner.start('📝 Generating narration script...');
  const script = await generateScript(
    {
      features: allFeatures,
      annotations: allAnnotations,
      siteUrl: config.url,
      siteTitle: crawlResult.manifest.title,
      style: config.style,
      targetDuration: typeof config.duration === 'number' ? config.duration : 60,
    },
    config.openaiApiKey,
  );

  writeFileSync(join(outputDir, 'script.json'), JSON.stringify(script, null, 2));
  spinner.succeed(`Script: ${script.segments.length} segments, ~${script.totalDurationSeconds}s`);

  // ── Stage 4: Synthesize Voice ───────────────────────────
  spinner.start('🎙️ Synthesizing voiceover...');
  const audioDir = join(outputDir, 'audio');

  const introPath = join(audioDir, 'intro.mp3');
  await synthesizeVoice(config, script.intro, introPath, script.emotion ?? 'warm');

  const audioSegments: AudioSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const segPath = join(audioDir, `segment-${i}.mp3`);
    await synthesizeVoice(config, seg.narration, segPath, seg.emotion ?? 'warm');
    const segDuration = estimateDuration(seg.narration);
    audioSegments.push({ path: segPath, startMs: 0, durationMs: segDuration });
  }

  const outroPath = join(audioDir, 'outro.mp3');
  await synthesizeVoice(config, script.outro, outroPath, script.emotion ?? 'warm');
  spinner.succeed('Voice synthesis complete');

  // ── Stage 5: Mix Audio ──────────────────────────────────
  spinner.start('🔊 Mixing audio...');
  const allAudioSegments: AudioSegment[] = [
    { path: introPath, startMs: 0, durationMs: estimateDuration(script.intro) },
    ...audioSegments,
    { path: outroPath, startMs: 0, durationMs: estimateDuration(script.outro) },
  ];

  const mergedAudioPath = join(audioDir, 'merged.mp3');
  await concatAudioSegments(allAudioSegments, mergedAudioPath);

  let finalAudioPath = mergedAudioPath;
  if (config.backgroundMusic && existsSync(config.backgroundMusic)) {
    const mixedPath = join(audioDir, 'mixed.mp3');
    await mixWithBackgroundMusic(mergedAudioPath, config.backgroundMusic, mixedPath);
    finalAudioPath = mixedPath;
  }

  const normalizedPath = join(audioDir, 'final.mp3');
  await normalizeAudio(finalAudioPath, normalizedPath, -16);
  finalAudioPath = normalizedPath;
  spinner.succeed('Audio mixed and normalized');

  // ── Stage 6: Annotate Frames ────────────────────────────
  spinner.start('🎨 Creating annotated frames...');
  const annotatedDir = join(outputDir, 'annotated');
  const firstScreenshot = [...crawlResult.screenshots.values()][0];

  if (firstScreenshot) {
    // Intro frame
    const introFramePath = join(annotatedDir, 'frame-000.png');
    const introAnnotated = await annotateFrame(firstScreenshot, {
      featureId: 'intro',
      highlight: { x: 0, y: 0, width: resolution.width, height: resolution.height, style: 'dim-bg' },
    });
    writeFileSync(introFramePath, introAnnotated);

    // Feature frames with annotations
    for (let i = 0; i < script.segments.length; i++) {
      const seg = script.segments[i];
      const feature = allFeatures.find((f: any) => f.id === seg.featureId);
      const annotation = allAnnotations.find((a: any) => a.featureId === seg.featureId);

      let screenshotBuf = firstScreenshot;
      for (const [key, buf] of crawlResult.screenshots) {
        const pageInfo = crawlResult.manifest.pages.find((p: any) => p.screenshotPath.includes(key));
        if (pageInfo?.url === feature?.pageUrl) {
          screenshotBuf = buf;
          break;
        }
      }

      const framePath = join(annotatedDir, `frame-${String(i + 1).padStart(3, '0')}.png`);
      let cursorPos: { x: number; y: number } | undefined;
      if (config.cursor === 'animated' && feature?.element?.rect) {
        const rect = feature.element.rect;
        cursorPos = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }

      const annotated = await annotateFrame(
        screenshotBuf,
        annotation ?? { featureId: seg.featureId },
        cursorPos,
      );
      writeFileSync(framePath, annotated);
    }

    // Outro frame
    const outroFramePath = join(annotatedDir, `frame-${String(script.segments.length + 1).padStart(3, '0')}.png`);
    const outroAnnotated = await annotateFrame(firstScreenshot, {
      featureId: 'outro',
      highlight: { x: 0, y: 0, width: resolution.width, height: resolution.height, style: 'dim-bg' },
    });
    writeFileSync(outroFramePath, outroAnnotated);
  }

  const frameCount = script.segments.length + 2; // intro + segments + outro
  spinner.succeed(`Created ${frameCount} annotated frames`);

  // ── Stage 7: Compose Video ──────────────────────────────
  spinner.start('🎬 Composing video...');

  if (config.format === 'shorts') {
    // Shorts mode: vertical scrolling video from full-page screenshots
    await composeShortsVideo({
      screenshotDir: join(outputDir, 'screenshots'),
      audioPath: finalAudioPath,
      outputPath: config.output,
      resolution,
      fps: 30,
      transition: 'fade',
      transitionDuration: 0.5,
    });
  } else {
    // Standard landscape mode: annotated frames with transitions
    await composeWithFfmpeg({
      frameDir: annotatedDir,
      audioPath: finalAudioPath,
      outputPath: config.output,
      fps: 30,
      transition: 'fade',
      transitionDuration: 0.5,
      resolution,
      kenBurns: true,
    });
  }

  const elapsed = Date.now() - startTime;
  spinner.succeed(chalk.green(`✨ Demo video created: ${config.output}`));
  console.log(chalk.gray(`   Duration: ~${Math.round(elapsed / 1000)}s | Segments: ${script.segments.length}`));

  return { outputPath: config.output, durationMs: elapsed, segments: script.segments.length };
}

async function synthesizeVoice(
  config: VixieConfig,
  text: string,
  outputPath: string,
  emotion: 'warm' | 'energetic' | 'calm' | 'dramatic' = 'warm',
): Promise<void> {
  switch (config.ttsProvider) {
    case 'kokoro': {
      const kokoroConfig = getKokoroVoicePreset(config.voice);
      await synthesizeWithKokoro(text, outputPath, kokoroConfig);
      break;
    }
    case 'edge': {
      const voiceConfig = getVoicePreset(config.voice);
      await synthesizeWithEdge(text, outputPath, voiceConfig, { emotion });
      break;
    }
    case 'openai': {
      if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY required for OpenAI TTS');
      const voiceConfig = getOpenAIVoicePreset(config.voice);
      await synthesizeWithOpenAI(text, outputPath, config.openaiApiKey, voiceConfig);
      break;
    }
    case 'elevenlabs': {
      if (!config.elevenlabsApiKey) throw new Error('ELEVENLABS_API_KEY required for ElevenLabs TTS');
      const voiceConfig = getElevenLabsPreset(config.voice);
      await synthesizeWithElevenLabs(text, outputPath, config.elevenlabsApiKey, voiceConfig);
      break;
    }
  }
}

function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max((words / 160) * 60000, 3000);
}
