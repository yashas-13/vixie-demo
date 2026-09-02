import { execSync } from 'child_process';
import { readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface FfmpegComposerInput {
  frameDir: string;
  audioPath: string;
  outputPath: string;
  fps: number;
  transition: 'fade' | 'cut' | 'slide';
  transitionDuration: number;
  resolution: { width: number; height: number };
  kenBurns: boolean;
  backgroundMusicPath?: string;
}

export async function composeWithFfmpeg(input: FfmpegComposerInput): Promise<string> {
  const {
    frameDir,
    audioPath,
    outputPath,
    fps = 30,
    transition = 'fade',
    transitionDuration = 0.5,
    resolution,
  } = input;

  const frames = readdirSync(frameDir)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    });

  if (frames.length === 0) throw new Error('No frames found');

  let audioDurationSec = 15;
  try {
    const durStr = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    audioDurationSec = parseFloat(durStr);
  } catch { /* fallback */ }

  const segDuration = audioDurationSec / frames.length;
  const fadeDur = Math.min(transitionDuration, segDuration * 0.4);

  if (frames.length === 1) {
    execSync(
      `ffmpeg -y -loop 1 -i "${join(frameDir, frames[0])}" -i "${audioPath}" ` +
      `-vf "scale=${resolution.width}:${resolution.height}:flags=lanczos" ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r ${fps} ` +
      `-c:a aac -b:a 128k -shortest -movflags +faststart ` +
      `"${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
    return outputPath;
  }

  // Build input args: each frame as -loop 1 -t <segDuration>
  const inputArgs: string[] = [];
  for (const f of frames) {
    inputArgs.push(`-loop 1 -t ${segDuration.toFixed(3)} -i "${join(frameDir, f)}"`);
  }
  inputArgs.push(`-i "${audioPath}"`);

  const audioIdx = frames.length;

  if (transition === 'fade' && frames.length > 1) {
    // Build xfade filter chain in a single ffmpeg command
    let filterParts: string[] = [];
    let lastLabel = '[0:v]';

    for (let i = 1; i < frames.length; i++) {
      const offset = i * segDuration - i * fadeDur;
      const outLabel = i === frames.length - 1 ? '[vout]' : `[v${i}]`;
      filterParts.push(
        `${lastLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`
      );
      lastLabel = outLabel;
    }

    const filterComplex = filterParts.join(';');

    execSync(
      `ffmpeg -y ${inputArgs.join(' ')} ` +
      `-filter_complex "${filterComplex}" ` +
      `-map "[vout]" -map ${audioIdx}:a ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r ${fps} ` +
      `-c:a aac -b:a 128k -shortest -movflags +faststart ` +
      `"${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
  } else {
    // Simple concat with concat filter
    const filterParts: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      filterParts.push(`[${i}:v]scale=${resolution.width}:${resolution.height}:flags=lanczos,setsar=1[f${i}]`);
    }
    const concatInputs = frames.map((_, i) => `[f${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${frames.length}:v=1:a=0[vout]`);

    const filterComplex = filterParts.join(';');

    execSync(
      `ffmpeg -y ${inputArgs.join(' ')} ` +
      `-filter_complex "${filterComplex}" ` +
      `-map "[vout]" -map ${audioIdx}:a ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r ${fps} ` +
      `-c:a aac -b:a 128k -shortest -movflags +faststart ` +
      `"${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
  }

  return outputPath;
}
