/**
 * Shorts Composer — creates vertical scrolling videos from tall full-page screenshots.
 */
import { execSync } from 'child_process';
import { readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

export interface ShortsComposerInput {
  screenshotDir: string;
  audioPath: string;
  outputPath: string;
  resolution: { width: number; height: number };
  fps: number;
  transition: 'fade' | 'cut' | 'slide';
  transitionDuration: number;
}

interface ScrollSegment {
  imagePath: string;
  imgWidth: number;
  imgHeight: number;
  scrollRange: number;
  viewHeight: number;
  duration: number;
}

export async function composeShortsVideo(input: ShortsComposerInput): Promise<string> {
  const {
    screenshotDir,
    audioPath,
    outputPath,
    resolution,
    fps = 30,
    transition = 'fade',
    transitionDuration = 0.5,
  } = input;

  const pageFiles = readdirSync(screenshotDir)
    .filter(f => /^page-\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));

  if (pageFiles.length === 0) throw new Error('No page screenshots found');

  console.log(`  📐 ${pageFiles.length} pages for scrolling`);

  let totalAudioSec = 15;
  try {
    totalAudioSec = parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`, { encoding: 'utf-8', stdio: 'pipe' }).trim()
    );
  } catch {}

  // Analyze each screenshot
  const segments: ScrollSegment[] = [];
  for (const f of pageFiles) {
    const imgPath = join(screenshotDir, f);
    const meta = await sharp(imgPath).metadata();
    const w = meta.width ?? resolution.width;
    const h = meta.height ?? resolution.height;
    const vh = resolution.height;
    const sr = Math.max(0, h - vh);
    segments.push({ imagePath: imgPath, imgWidth: w, imgHeight: h, scrollRange: sr, viewHeight: vh, duration: 0 });
  }

  // Distribute time by scroll range (min 3s per page)
  const totalScroll = segments.reduce((s, seg) => s + Math.max(seg.scrollRange, seg.viewHeight), 0);
  for (const seg of segments) {
    seg.duration = Math.max(3, (Math.max(seg.scrollRange, seg.viewHeight) / totalScroll) * totalAudioSec);
  }

  const frameDir = join(screenshotDir, '..', 'scroll-frames');
  mkdirSync(frameDir, { recursive: true });

  // Generate each scroll segment as a separate video
  const segOutputs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segOut = join(frameDir, `scroll-${i}.mp4`);
    segOutputs.push(segOut);
    const dur = seg.duration.toFixed(3);

    if (seg.scrollRange <= 0) {
      // No scroll needed — static centered
      const pad = Math.max(0, Math.floor((seg.viewHeight - seg.imgHeight) / 2));
      execSync(
        `ffmpeg -y -loop 1 -i "${seg.imagePath}" ` +
        `-vf "scale=${resolution.width}:-1,pad=${resolution.width}:${seg.viewHeight}:0:${pad}:color=black,setsar=1" ` +
        `-t ${dur} -r ${fps} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${segOut}"`,
        { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
      );
    } else {
      // Scale to width then crop-pan vertically
      execSync(
        `ffmpeg -y -loop 1 -i "${seg.imagePath}" ` +
        `-vf "scale=${resolution.width}:-1:flags=lanczos,` +
        `crop=${resolution.width}:${seg.viewHeight}:0:'min(${seg.scrollRange},max(0,(ih-oh)*t/${dur}))',` +
        `setsar=1" ` +
        `-t ${dur} -r ${fps} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${segOut}"`,
        { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
      );
    }
    console.log(`  🎬 Scroll ${i + 1}/${segments.length}: ${seg.imgHeight}px → ${dur}s`);
  }

  // Stitch segments
  const fadeDur = Math.min(transitionDuration, 0.3);
  const inputArgs = segOutputs.map(f => `-i "${f}"`).join(' ');
  const audioIdx = segOutputs.length;

  if (segOutputs.length === 1) {
    execSync(
      `ffmpeg -y -i "${segOutputs[0]}" -i "${audioPath}" ` +
      `-map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
  } else if (transition === 'fade') {
    const filterParts: string[] = [];
    let lastLabel = '[0:v]';
    for (let i = 1; i < segOutputs.length; i++) {
      let offset = 0;
      for (let j = 0; j < i; j++) offset += segments[j].duration;
      offset -= i * fadeDur;
      const outLabel = i === segOutputs.length - 1 ? '[vout]' : `[v${i}]`;
      filterParts.push(
        `${lastLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}${outLabel}`
      );
      lastLabel = outLabel;
    }
    execSync(
      `ffmpeg -y ${inputArgs} -i "${audioPath}" ` +
      `-filter_complex "${filterParts.join(';')}" ` +
      `-map "[vout]" -map ${audioIdx}:a ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r ${fps} ` +
      `-c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
  } else {
    const fp = segOutputs.map((_, i) => `[${i}:v]scale=${resolution.width}:${resolution.height}:flags=lanczos,setsar=1[f${i}]`);
    const ci = segOutputs.map((_, i) => `[f${i}]`).join('');
    fp.push(`${ci}concat=n=${segOutputs.length}:v=1:a=0[vout]`);
    execSync(
      `ffmpeg -y ${inputArgs} -i "${audioPath}" ` +
      `-filter_complex "${fp.join(';')}" ` +
      `-map "[vout]" -map ${audioIdx}:a ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r ${fps} ` +
      `-c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 },
    );
  }

  console.log(`  ✅ Shorts video created: ${outputPath}`);
  return outputPath;
}
