import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

export interface AudioSegment {
  path: string;
  startMs: number;
  durationMs: number;
}

export interface MixOptions {
  backgroundMusic?: string;
  musicVolume: number;  // 0.0 - 1.0, typically 0.05 - 0.15
  fadeOutSeconds: number;
}

export async function concatAudioSegments(
  segments: AudioSegment[],
  outputPath: string,
): Promise<string> {
  if (segments.length === 0) throw new Error('No audio segments to concatenate');

  // Create a silent audio file for gaps
  const silencePath = join(tmpdir(), 'vixie-silence.mp3');
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -q:a 9 "${silencePath}"`,
    { stdio: 'pipe' },
  );

  // Build concat list
  const listPath = join(tmpdir(), 'vixie-concat.txt');
  let concatContent = '';

  for (let i = 0; i < segments.length; i++) {
    concatContent += `file '${segments[i].path}'\n`;
    if (i < segments.length - 1) {
      concatContent += `file '${silencePath}'\n`;
    }
  }

  writeFileSync(listPath, concatContent);

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
    { stdio: 'pipe' },
  );

  // Cleanup
  try { unlinkSync(silencePath); } catch { /* ignore */ }
  try { unlinkSync(listPath); } catch { /* ignore */ }

  return outputPath;
}

export async function mixWithBackgroundMusic(
  voicePath: string,
  musicPath: string,
  outputPath: string,
  options: MixOptions = { musicVolume: 0.08, fadeOutSeconds: 3 },
): Promise<string> {
  if (!existsSync(musicPath)) {
    // No background music available, just copy the voice
    const voiceData = readFileSync(voicePath);
    writeFileSync(outputPath, voiceData);
    return outputPath;
  }

  // Get voice duration
  const durationMatch = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${voicePath}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  ).trim();

  const voiceDuration = parseFloat(durationMatch);

  // Mix voice + background music with volume adjustment and fade out
  execSync(
    `ffmpeg -y -i "${voicePath}" -i "${musicPath}" ` +
    `-filter_complex "[1:a]volume=${options.musicVolume},afade=t=out:st=${voiceDuration - options.fadeOutSeconds}:d=${options.fadeOutSeconds}[music];` +
    `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[out]" ` +
    `-map "[out]" -c:a libmp3lame -q:a 2 "${outputPath}"`,
    { stdio: 'pipe' },
  );

  return outputPath;
}

export async function getAudioDuration(audioPath: string): Promise<number> {
  const result = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  ).trim();
  return parseFloat(result) * 1000; // Return in ms
}

export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  targetLevel: number = -16,
): Promise<string> {
  execSync(
    `ffmpeg -y -i "${inputPath}" -af loudnorm=I=${targetLevel}:TP=-1.5:LRA=11 "${outputPath}"`,
    { stdio: 'pipe' },
  );
  return outputPath;
}
