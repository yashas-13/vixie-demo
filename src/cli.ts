#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveConfig } from './utils/config.js';
import { generateDemo } from './index.js';

const program = new Command();

program
  .name('vixie')
  .description('AI-powered product demo video generator — URL to professional MP4 with voiceover')
  .version('1.0.0');

program
  .command('generate')
  .alias('g')
  .description('Generate a demo video from a URL')
  .argument('<url>', 'Website URL to create demo for')
  .option('-o, --output <path>', 'Output file path', 'demo.mp4')
  .option('--voice <name>', 'TTS voice name or preset', 'en-US-JennyNeural')
  .option('--tts <provider>', 'TTS provider: edge | openai | elevenlabs', 'edge')
  .option('--style <style>', 'Demo style: professional | casual | technical', 'professional')
  .option('--cursor <mode>', 'Cursor mode: animated | none', 'animated')
  .option('--rich', 'Use Remotion for rich video composition', false)
  .option('--resolution <res>', 'Resolution: 720p | 1080p | 4K', '1080p')
  .option('--max-pages <n>', 'Max pages to crawl', '3')
  .option('--duration <seconds>', 'Target duration in seconds', 'auto')
  .option('--sections <list>', 'Comma-separated sections to demo')
  .option('--dry-run', 'Preview analysis + script only', false)
  .option('--background-music <path>', 'Background music file path')
  .action(async (url, opts) => {
    console.log(chalk.cyan('\n🎬 Vixie — AI Product Demo Generator\n'));

    const config = resolveConfig({
      output: opts.output,
      voice: opts.voice,
      ttsProvider: opts.tts,
      style: opts.style,
      cursor: opts.cursor,
      rich: opts.rich,
      resolution: opts.resolution,
      maxPages: parseInt(opts.maxPages, 10),
      duration: opts.duration === 'auto' ? 'auto' : parseInt(opts.duration, 10),
      sections: opts.sections ? opts.sections.split(',') : 'all',
      dryRun: opts.dryRun,
      backgroundMusic: opts.backgroundMusic ?? null,
    }, url);

    try {
      const result = await generateDemo(config);
      console.log(chalk.green(`\n✅ Demo video created: ${result.outputPath}`));
    } catch (err: any) {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('quick <url>')
  .description('Quick demo with smart defaults')
  .option('-o, --output <path>', 'Output file', 'demo.mp4')
  .option('--voice <name>', 'Voice name', 'en-US-JennyNeural')
  .action(async (url, opts) => {
    console.log(chalk.cyan('\n⚡ Vixie Quick Mode\n'));

    const config = resolveConfig({
      output: opts.output,
      voice: opts.voice,
      ttsProvider: 'edge',
      style: 'professional',
      cursor: 'animated',
      rich: false,
      resolution: '1080p',
      maxPages: 2,
      duration: 'auto',
      sections: 'all',
      dryRun: false,
    }, url);

    try {
      const result = await generateDemo(config);
      console.log(chalk.green(`\n✅ Demo created: ${result.outputPath}`));
    } catch (err: any) {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('voices')
  .description('List available voices')
  .option('--provider <name>', 'TTS provider: edge | openai', 'edge')
  .action(async (opts) => {
    if (opts.provider === 'edge') {
      const { listEdgeVoices } = await import('./voice/edge-tts.js');
      const voices = await listEdgeVoices();
      console.log(chalk.cyan('\n🎤 Available Edge TTS Voices:\n'));
      for (const v of voices) {
        console.log(`  ${chalk.green(v)}`);
      }
    } else if (opts.provider === 'openai') {
      const { listOpenAIVoices } = await import('./voice/openai-tts.js');
      const voices = listOpenAIVoices();
      console.log(chalk.cyan('\n🎤 Available OpenAI TTS Voices:\n'));
      for (const v of voices) {
        console.log(`  ${chalk.green(v.id)} — ${v.name}`);
      }
    }
  });

program
  .command('serve')
  .description('Start the web dashboard and API server')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (opts) => {
    const { startServer } = await import('./api/server.js');
    await startServer(parseInt(opts.port, 10));
  });


program
  .command('analyze <video>')
  .description('Analyze a demo video for annotation presence and quality')
  .option('-f, --frames <n>', 'Number of frames to extract', '10')
  .option('-o, --output <dir>', 'Output directory for report', '')
  .option('--no-vision', 'Skip AI vision QA (auto-enabled when OPENAI_API_KEY is set)', undefined)
  .action(async (video, opts) => {
    console.log(chalk.cyan('\n🔍 Vixie Video Analyzer\n'));
    const { analyzeVideo } = await import('./video/analyzer.js');
    try {
      const outputDir = opts.output || video.replace(/\.[^.]+$/, '') + '_analysis';
      const report = await analyzeVideo(video, {
        framesToExtract: parseInt(opts.frames, 10),
        outputDir,
        vision: opts.vision !== false,
        openaiApiKey: process.env.OPENAI_API_KEY ?? null,
      });
      console.log(chalk.gray(`\nReport saved to: ${outputDir}/report.json`));
      console.log(chalk.gray(`Text report:     ${outputDir}/report.txt`));
    } catch (err: any) {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
