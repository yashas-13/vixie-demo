import { execSync } from 'child_process';
import { mkdirSync, existsSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import OpenAI from 'openai';

// ── Types ──────────────────────────────────────────────────────────────────

export interface VideoMetadata {
  filePath: string;
  fileSizeBytes: number;
  fileSizeMB: number;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  profile: string;
  pixelFormat: string;
  frameRate: number;
  totalFrames: number;
  bitRate: number;
  audioCodec: string;
  audioSampleRate: number;
  audioChannels: number;
  aspectRatio: string;
  dpi: number | null;
}

export interface AnnotationDetection {
  frameFile: string;
  frameIndex: number;
  arrows: { detected: boolean; pixelCount: number; percentage: number; blobs: number; boxes: BBox[]; interpolated?: boolean };
  glow: { detected: boolean; pixelCount: number; percentage: number; blobs: number; boxes: BBox[]; interpolated?: boolean };
  dimBg: { detected: boolean; pixelCount: number; percentage: number };
  labels: { detected: boolean; pixelCount: number; percentage: number; blobs: number; boxes: BBox[]; interpolated?: boolean };
  cursor: { detected: boolean; pixelCount: number; blobs: number; boxes: BBox[]; interpolated?: boolean };
  buttons: { detected: boolean; pixelCount: number; percentage: number };
  forms: { detected: boolean; pixelCount: number; percentage: number };
  text: { detected: boolean; density: number };
  uiElements: { detected: boolean; pixelCount: number; percentage: number };
  anyAnnotation: boolean;
  annotationDensity: number;
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface AnalysisReport {
  metadata: VideoMetadata;
  frames: AnnotationDetection[];
  checks: QualityCheck[];
  visualVerification: string[];
  multimodal: MultimodalVerification | null;
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    failures: number;
    overallScore: number;
    verdict: 'PASS' | 'WARN' | 'FAIL';
  };
  timestamp: string;
}

export interface MultimodalFrameCheck {
  frameFile: string;
  frameIndex: number;
  visible: string[];
  issues: string[];
  verdict: 'ok' | 'issue';
}

export interface MultimodalVerification {
  model: string;
  frames: MultimodalFrameCheck[];
  summary: string;
}

// ── Metadata extraction ────────────────────────────────────────────────────

export function extractMetadata(filePath: string): VideoMetadata {
  if (!existsSync(filePath)) {
    throw new Error(`Video file not found: ${filePath}`);
  }

  const fileSizeBytes = statSync(filePath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);

  const probeJson = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const probe = JSON.parse(probeJson);
  const videoStream = probe.streams?.find((s: any) => s.codec_type === 'video');
  const audioStream = probe.streams?.find((s: any) => s.codec_type === 'audio');
  const format = probe.format || {};

  const durationSeconds = parseFloat(format.duration || '0');
  const bitRate = parseInt(format.bit_rate || videoStream?.bit_rate || '0', 10);
  const frameRateStr = videoStream?.r_frame_rate || '30/1';
  const [num, den] = frameRateStr.split('/').map(Number);
  const frameRate = den ? Math.round(num / den) : 30;

  const width = videoStream?.width || 0;
  const height = videoStream?.height || 0;
  const displayWidth = videoStream?.display_aspect_ratio || '';
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const g = gcd(width, height);
  const aspectRatio = g ? `${width / g}:${height / g}` : displayWidth;

  const dpi = videoStream?.sample_aspect_ratio && videoStream.sample_aspect_ratio !== '1:1'
    ? (() => { const [sn, sd] = videoStream.sample_aspect_ratio.split(':').map(Number); return Math.round(72 * sn / sd); })()
    : null;

  return {
    filePath,
    fileSizeBytes,
    fileSizeMB: Math.round(fileSizeMB * 100) / 100,
    durationSeconds,
    width,
    height,
    codec: videoStream?.codec_name || 'unknown',
    profile: videoStream?.profile || 'unknown',
    pixelFormat: videoStream?.pix_fmt || 'unknown',
    frameRate,
    totalFrames: videoStream?.nb_frames ? parseInt(videoStream.nb_frames, 10) : Math.round(durationSeconds * frameRate),
    bitRate,
    audioCodec: audioStream?.codec_name || 'none',
    audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0,
    audioChannels: audioStream?.channels || 0,
    aspectRatio,
    dpi,
  };
}

// ── Frame extraction ───────────────────────────────────────────────────────

export function extractFrames(filePath: string, outputDir: string, framesToExtract: number = 10): string[] {
  mkdirSync(outputDir, { recursive: true });

  for (const f of readdirSync(outputDir)) {
    if (f.endsWith('.png') || f.endsWith('.jpg')) {
      unlinkSync(join(outputDir, f));
    }
  }

  const metadata = extractMetadata(filePath);
  const duration = metadata.durationSeconds;
  if (duration <= 0) throw new Error('Video has zero duration');

  const interval = duration / framesToExtract;
  const extractedFrames: string[] = [];

  for (let i = 0; i < framesToExtract; i++) {
    const timestamp = i * interval + interval / 2;
    const framePath = join(outputDir, `analyzed-frame-${String(i).padStart(3, '0')}.png`);

    try {
      execSync(
        `ffmpeg -y -ss ${timestamp.toFixed(3)} -i "${filePath}" ` +
        `-frames:v 1 -q:v 2 "${framePath}"`,
        { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
      );
      if (existsSync(framePath)) {
        extractedFrames.push(framePath);
      }
    } catch {
      // Skip failed frames
    }
  }

  return extractedFrames;
}

// ── Connected component analysis ───────────────────────────────────────────

export interface BBox { x1: number; y1: number; x2: number; y2: number; count: number; }

function findBlobs(mask: Uint8Array, width: number, height: number, minSize: number): BBox[] {
  const visited = new Uint8Array(mask.length);
  const blobs: BBox[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx] || visited[idx]) continue;

      let queue = [idx];
      visited[idx] = 1;
      let x1 = x, y1 = y, x2 = x, y2 = y, count = 0;

      while (queue.length > 0) {
        const next: number[] = [];
        for (const ci of queue) {
          count++;
          const cx = ci % width;
          const cy = (ci - cx) / width;
          if (cx < x1) x1 = cx;
          if (cy < y1) y1 = cy;
          if (cx > x2) x2 = cx;
          if (cy > y2) y2 = cy;
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[1,1],[-1,1],[1,-1],[-1,-1]] as [number,number][]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const ni = ny * width + nx;
              if (mask[ni] && !visited[ni]) {
                visited[ni] = 1;
                next.push(ni);
              }
            }
          }
        }
        queue = next;
      }

      if (count >= minSize) {
        blobs.push({ x1, y1, x2, y2, count });
      }
    }
  }

  return blobs;
}

function dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      out[y * width + x] = 1;
      if (x > 0) out[y * width + x - 1] = 1;
      if (x < width - 1) out[y * width + x + 1] = 1;
      if (y > 0) out[(y - 1) * width + x] = 1;
      if (y < height - 1) out[(y + 1) * width + x] = 1;
    }
  }
  return out;
}

function colorDistance(r: number, g: number, b: number, rr: number, gg: number, bb: number): number {
  return Math.sqrt((r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2);
}

// ── Enhanced pixel analysis ────────────────────────────────────────────────

async function analyzeFramePixels(framePath: string): Promise<AnnotationDetection> {
  const image = sharp(framePath);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const totalPixels = width * height;

  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ── Build binary masks ──
  const arrowMask = new Uint8Array(totalPixels);
  const glowMask = new Uint8Array(totalPixels);
  const labelMask = new Uint8Array(totalPixels);
  const dimBgMask = new Uint8Array(totalPixels);
  const buttonMask = new Uint8Array(totalPixels);
  const formMask = new Uint8Array(totalPixels);
  const uiMask = new Uint8Array(totalPixels);

  let cursorPixelCount = 0;
  let textPixelCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const pi = i * 4;
    const r = data[pi];
    const g = data[pi + 1];
    const b = data[pi + 2];

    // Arrow: pink/coral annotation family, Euclidean distance (H.264 safe)
    if (colorDistance(r, g, b, 251, 138, 135) < 80) {
      arrowMask[i] = 1;
    }

    // Glow: orange/amber (#FF6B35 family)
    if (r > 200 && g > 40 && g < 200 && b < 140 && (r - b) > 100) {
      glowMask[i] = 1;
    }

    // Label: blue/violet annotation family, Euclidean distance (H.264 safe)
    if (colorDistance(r, g, b, 127, 141, 255) < 110) {
      labelMask[i] = 1;
    }

    // Dim background: dark overlay
    if (r < 55 && g < 55 && b < 55) {
      dimBgMask[i] = 1;
    }

    // Buttons: medium-dark rectangles with specific hue (CTA buttons)
    // Look for saturated non-white, non-black rectangular regions
    if (r > 30 && g > 30 && b > 30 && r < 230 && g < 230 && b < 230) {
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (saturation > 40) {
        buttonMask[i] = 1;
      }
    }

    // Forms: input-like rectangular regions with light gray borders
    if (r > 180 && r < 240 && g > 180 && g < 240 && b > 180 && b < 240) {
      formMask[i] = 1;
    }

    // UI elements: colored regions (non-white, non-black, non-gray)
    if (r > 10 && g > 10 && b > 10 && r < 245 && g < 245 && b < 245) {
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (saturation > 30) {
        uiMask[i] = 1;
      }
    }

    // Text: near-black pixels on white/light backgrounds
    if (r < 60 && g < 60 && b < 60) {
      textPixelCount++;
    }

    // Cursor: small white cluster
    if (r > 235 && g > 235 && b > 235) {
      cursorPixelCount++;
    }
  }

  // ── Blob analysis ──
  // Arrows: dilate once so compressed/dashed strokes connect, then require shape
  const dilatedArrow = dilateMask(arrowMask, width, height);
  const arrowBlobs = findBlobs(dilatedArrow, width, height, 8)
    .filter(b => (b.x2 - b.x1) >= 6 && (b.y2 - b.y1) >= 4);
  const hasArrowBlobs = arrowBlobs.length > 0;

  const glowBlobs = findBlobs(glowMask, width, height, 20);
  const hasGlowBlobs = glowBlobs.length > 0;

  // Labels: require a wide bar so bluish UI pixels don't register
  const labelBlobs = findBlobs(labelMask, width, height, 5)
    .filter(b => (b.x2 - b.x1) >= 40 && (b.y2 - b.y1) >= 4);
  const hasLabelBlobs = labelBlobs.length > 0;

  // Dim-bg: large dark regions
  const dimBgBlobs = findBlobs(dimBgMask, width, height, totalPixels * 0.02);
  const hasDimBg = dimBgBlobs.some(b => {
    const area = (b.x2 - b.x1) * (b.y2 - b.y1);
    return area > totalPixels * 0.05;
  });

  // Buttons: look for isolated colored rectangular blobs
  const buttonBlobs = findBlobs(buttonMask, width, height, 100);
  const hasButtons = buttonBlobs.some(b => {
    const bw = b.x2 - b.x1;
    const bh = b.y2 - b.y1;
    return bw > 30 && bh > 10 && bw > bh; // Horizontal rectangles (buttons)
  });

  // Forms: input-like horizontal rectangles
  const formBlobs = findBlobs(formMask, width, height, 200);
  const hasForms = formBlobs.some(b => {
    const bw = b.x2 - b.x1;
    const bh = b.y2 - b.y1;
    return bw > 60 && bh > 8 && bw > bh * 2; // Wide, thin rectangles
  });

  // UI elements: large colored regions
  const uiBlobs = findBlobs(uiMask, width, height, 500);
  const hasUI = uiBlobs.length > 0;

  // Cursor: small isolated white pointer-shaped blobs away from the frame edge
  const whiteMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const pi = i * 4;
    const r = data[pi], g = data[pi + 1], b = data[pi + 2];
    if (r > 230 && g > 230 && b > 230) {
      whiteMask[i] = 1;
    }
  }
  const cursorBlobs = findBlobs(whiteMask, width, height, 40).filter(b => {
    const bw = b.x2 - b.x1;
    const bh = b.y2 - b.y1;
    return b.count <= 1500 && bw <= 70 && bh <= 70 && b.x1 >= 5 && b.y1 >= 30 &&
      Math.max(bw, bh) / Math.max(Math.min(bw, bh), 1) <= 3 && bw >= 6 && bh >= 8;
  });

  // Text density
  const textDensity = textPixelCount / totalPixels;

  // ── Pixel counts ──
  let arrowPixels = 0, glowPixels = 0, labelPixels = 0, dimBgPixels = 0, buttonPixels = 0, formPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (arrowMask[i]) arrowPixels++;
    if (glowMask[i]) glowPixels++;
    if (labelMask[i]) labelPixels++;
    if (dimBgMask[i]) dimBgPixels++;
    if (buttonMask[i]) buttonPixels++;
    if (formMask[i]) formPixels++;
  }

  const pct = (count: number) => Math.round((count / totalPixels) * 10000) / 100;

  const annotationDensity = Math.min(
    (arrowPixels + glowPixels + labelPixels) / totalPixels +
    (hasDimBg ? 0.15 : 0),
    1
  );

  const fileName = framePath.split('/').pop() || '';

  return {
    frameFile: fileName,
    frameIndex: parseInt(fileName.replace(/\D/g, ''), 10) || 0,
    arrows: { detected: hasArrowBlobs, pixelCount: arrowPixels, percentage: pct(arrowPixels), blobs: arrowBlobs.length, boxes: arrowBlobs },
    glow: { detected: hasGlowBlobs, pixelCount: glowPixels, percentage: pct(glowPixels), blobs: glowBlobs.length, boxes: glowBlobs },
    dimBg: { detected: hasDimBg, pixelCount: dimBgPixels, percentage: pct(dimBgPixels) },
    labels: { detected: hasLabelBlobs, pixelCount: labelPixels, percentage: pct(labelPixels), blobs: labelBlobs.length, boxes: labelBlobs },
    cursor: { detected: cursorBlobs.length > 0, pixelCount: cursorPixelCount, blobs: cursorBlobs.length, boxes: cursorBlobs },
    buttons: { detected: hasButtons, pixelCount: buttonPixels, percentage: pct(buttonPixels) },
    forms: { detected: hasForms, pixelCount: formPixels, percentage: pct(formPixels) },
    text: { detected: textDensity > 0.001, density: Math.round(textDensity * 10000) / 100 },
    uiElements: { detected: hasUI, pixelCount: 0, percentage: pct(uiBlobs.reduce((s, b) => s + b.count, 0)) },
    anyAnnotation: hasArrowBlobs || hasGlowBlobs || hasDimBg || hasLabelBlobs,
    annotationDensity,
  };
}

// ── Visual verification overlay ────────────────────────────────────────

function svgBox(b: BBox, stroke: string, strokeWidth = 2, dash = ''): string {
  const bw = Math.max(b.x2 - b.x1, 2);
  const bh = Math.max(b.y2 - b.y1, 2);
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<rect x="${b.x1}" y="${b.y1}" width="${bw}" height="${bh}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}/>`;
}

function svgArrow(x1: number, y1: number, x2: number, y2: number, color: string, lineWidth = 4, head = 15): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const hx = x1 + ux * Math.max(len - head, 1);
  const hy = y1 + uy * Math.max(len - head, 1);
  const s = head * 0.45;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round"/>` +
    `<polygon points="${x2},${y2} ${hx + px * s},${hy + py * s} ${hx - px * s},${hy - py * s}" fill="${color}"/>`
  );
}

function svgChip(x: number, y: number, text: string, color: string, fontSize = 11): string {
  const cw = text.length * (fontSize * 0.62) + 14;
  const ch = fontSize + 8;
  return (
    `<rect x="${x}" y="${y - ch + 2}" width="${cw}" height="${ch}" rx="4" fill="rgba(12,12,24,0.8)"/>` +
    `<text x="${x + 7}" y="${y - 2}" font-family="monospace" font-size="${fontSize}" fill="${color}" font-weight="bold">${text}</text>`
  );
}

async function createVisualOverlay(
  framePath: string,
  detection: AnnotationDetection,
  outputDir: string
): Promise<string> {
  const overlayPath = join(outputDir, 'verification-' + detection.frameFile);

  const image = sharp(framePath);
  const meta = await image.metadata();
  const w = meta.width || 1920;
  const h = meta.height || 1080;
  const totalPixels = w * h;
  const boxPct = (b: BBox) => ((((b.x2 - b.x1) + 1) * ((b.y2 - b.y1) + 1)) / totalPixels * 100).toFixed(2);

  const svgElements: string[] = [];
  const topBoxes = (boxes: BBox[], max: number) => [...boxes].sort((a, b) => b.count - a.count).slice(0, max);

  const annotate = (b: BBox, color: string, label: string, withArrow: boolean, dash = '') => {
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    const bw = Math.max(b.x2 - b.x1, 2);
    const bh = Math.max(b.y2 - b.y1, 2);
    const side = cx < w * 0.38 ? 'left' : cx > w * 0.62 ? 'right' : cy < h * 0.32 ? 'top' : 'bottom';

    let fromX = 0, fromY = 0, toX = 0, toY = 0, chipX = 0, chipY = 0;
    if (side === 'left') {
      fromX = Math.max(b.x1 - 46, 2); fromY = cy; toX = b.x1 - 4; toY = cy;
      chipX = Math.min(b.x2 + 8, w - 130); chipY = Math.max(b.y1 + 10, 14);
    } else if (side === 'right') {
      fromX = Math.min(b.x2 + 46, w - 2); fromY = cy; toX = b.x2 + 4; toY = cy;
      chipX = Math.max(b.x1 - 140, 2); chipY = Math.max(b.y1 + 10, 14);
    } else if (side === 'top') {
      fromX = cx; fromY = Math.max(b.y1 - 46, 2); toX = cx; toY = b.y1 - 4;
      chipX = Math.min(Math.max(b.x1 + 6, 2), w - 130); chipY = Math.min(b.y2 + 18, h - 6);
    } else {
      fromX = cx; fromY = Math.min(b.y2 + 46, h - 2); toX = cx; toY = b.y2 + 4;
      chipX = Math.min(Math.max(b.x1 + 6, 2), w - 130); chipY = Math.max(b.y1 - 10, 14);
    }

    svgElements.push(svgBox(b, color, 2, dash));
    if (withArrow) {
      svgElements.push(svgArrow(fromX, fromY, toX, toY, color));
    }
    const size = `${label} ${bw}×${bh}px · ${boxPct(b)}%`;
    svgElements.push(svgChip(Math.max(chipX, 2), Math.min(Math.max(chipY, 12), h - 6), size, color));
  };

  for (const b of topBoxes(detection.arrows.boxes, 5)) annotate(b, '#FF4D6D', 'A', true);
  for (const b of topBoxes(detection.labels.boxes, 4)) annotate(b, '#4DA6FF', 'L', true);
  for (const b of topBoxes(detection.glow.boxes, 1)) annotate(b, '#FF9F1C', 'G', false, '12,6');
  for (const b of topBoxes(detection.cursor.boxes, 2)) annotate(b, '#FFE14D', 'C', true);

  const status = `VIXIE  f${detection.frameIndex}  A${detection.arrows.blobs}  L${detection.labels.blobs}  G${detection.glow.blobs}  C${detection.cursor.blobs}`;
  svgElements.push(svgChip(12, 22, status, '#FFFFFF', 12));

  const svgOverlay = `<svg width="${w}" height="${h}">${svgElements.join('')}</svg>`;

  await image
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .png()
    .toFile(overlayPath);

  return overlayPath;
}

// ── Temporal persistence ───────────────────────────────────────────────────

function applyTemporalPersistence(frames: AnnotationDetection[]): void {
  const detections = (f: AnnotationDetection) =>
    [f.arrows, f.labels, f.glow, f.cursor] as { detected: boolean; pixelCount: number; interpolated?: boolean }[];
  for (let i = 0; i < frames.length; i++) {
    const cur = detections(frames[i]);
    for (let k = 0; k < cur.length; k++) {
      if (cur[k].detected || cur[k].pixelCount > 0) continue;
      const prev = i > 0 ? detections(frames[i - 1])[k] : null;
      const next = i < frames.length - 1 ? detections(frames[i + 1])[k] : null;
      if (prev && next && (prev.detected || next.detected)) {
        cur[k].detected = true;
        cur[k].interpolated = true;
      }
    }
  }
}

// ── Quality checks ─────────────────────────────────────────────────────────

function runQualityChecks(metadata: VideoMetadata, frames: AnnotationDetection[]): QualityCheck[] {
  const checks: QualityCheck[] = [];

  // Technical checks
  checks.push({
    name: 'Resolution',
    passed: metadata.width >= 1280 && metadata.height >= 720,
    message: `${metadata.width}×${metadata.height} ${metadata.width >= 1920 ? '(Full HD+)' : metadata.width >= 1280 ? '(HD)' : '(Low!)'}`,
    severity: metadata.width < 1280 ? 'critical' : 'info',
  });

  checks.push({
    name: 'Aspect Ratio',
    passed: metadata.aspectRatio === '16:9',
    message: `${metadata.aspectRatio} ${metadata.aspectRatio === '16:9' ? '(standard)' : '(non-standard)'}`,
    severity: metadata.aspectRatio !== '16:9' ? 'warning' : 'info',
  });

  checks.push({
    name: 'Duration',
    passed: metadata.durationSeconds >= 5 && metadata.durationSeconds <= 300,
    message: `${metadata.durationSeconds}s ${metadata.durationSeconds < 5 ? '(too short!)' : metadata.durationSeconds > 300 ? '(too long!)' : '(good)'}`,
    severity: metadata.durationSeconds < 5 ? 'critical' : metadata.durationSeconds > 300 ? 'warning' : 'info',
  });

  checks.push({
    name: 'Frame Rate',
    passed: metadata.frameRate >= 20 && metadata.frameRate <= 60,
    message: `${metadata.frameRate} fps`,
    severity: metadata.frameRate < 20 ? 'critical' : 'info',
  });

  checks.push({
    name: 'Codec',
    passed: metadata.codec === 'h264' || metadata.codec === 'h265' || metadata.codec === 'vp9',
    message: `${metadata.codec} ${metadata.profile}`,
    severity: metadata.codec === 'h264' ? 'info' : 'warning',
  });

  checks.push({
    name: 'Bitrate',
    passed: metadata.bitRate > 100000,
    message: `${(metadata.bitRate / 1000).toFixed(0)} kbps`,
    severity: metadata.bitRate < 100000 ? 'warning' : 'info',
  });

  checks.push({
    name: 'Audio',
    passed: metadata.audioCodec !== 'none' && metadata.audioChannels > 0,
    message: `${metadata.audioCodec} ${metadata.audioSampleRate}Hz ${metadata.audioChannels}ch ${metadata.audioCodec === 'none' ? '(NO AUDIO!)' : ''}`,
    severity: metadata.audioCodec === 'none' ? 'critical' : 'info',
  });

  checks.push({
    name: 'File Size',
    passed: metadata.fileSizeMB > 0.1 && metadata.fileSizeMB < 500,
    message: `${metadata.fileSizeMB} MB`,
    severity: metadata.fileSizeMB < 0.1 ? 'critical' : metadata.fileSizeMB > 500 ? 'warning' : 'info',
  });

  // Annotation-based checks
  const annotatedFrames = frames.filter(f => f.anyAnnotation).length;
  checks.push({
    name: 'Annotation Coverage',
    passed: annotatedFrames > 0,
    message: `${annotatedFrames}/${frames.length} frames have annotations`,
    severity: annotatedFrames === 0 ? 'critical' : 'info',
  });

  const arrowFrames = frames.filter(f => f.arrows.detected).length;
  checks.push({
    name: 'Arrows Present',
    passed: arrowFrames > 0,
    message: `${arrowFrames}/${frames.length} frames show arrows`,
    severity: arrowFrames === 0 ? 'warning' : 'info',
  });

  const glowFrames = frames.filter(f => f.glow.detected).length;
  checks.push({
    name: 'Glow Effects',
    passed: glowFrames > 0,
    message: `${glowFrames}/${frames.length} frames show glow effects`,
    severity: glowFrames === 0 ? 'warning' : 'info',
  });

  const labelFrames = frames.filter(f => f.labels.detected).length;
  checks.push({
    name: 'Labels/Captions',
    passed: labelFrames > 0,
    message: `${labelFrames}/${frames.length} frames have labels`,
    severity: labelFrames === 0 ? 'warning' : 'info',
  });

  const dimBgFrames = frames.filter(f => f.dimBg.detected).length;
  checks.push({
    name: 'Dim Background',
    passed: dimBgFrames > 0,
    message: `${dimBgFrames}/${frames.length} frames have dim overlays`,
    severity: dimBgFrames === 0 ? 'warning' : 'info',
  });

  const cursorFrames = frames.filter(f => f.cursor.detected).length;
  checks.push({
    name: 'Cursor/Pointer',
    passed: true,
    message: `${cursorFrames}/${frames.length} frames show cursor`,
    severity: 'info',
  });

  const buttonFrames = frames.filter(f => f.buttons.detected).length;
  checks.push({
    name: 'Buttons/CTAs',
    passed: true,
    message: `${buttonFrames}/${frames.length} frames show buttons`,
    severity: 'info',
  });

  const avgDensity = frames.reduce((s, f) => s + f.annotationDensity, 0) / Math.max(frames.length, 1);
  checks.push({
    name: 'Annotation Density',
    passed: avgDensity > 0.001,
    message: `Avg ${(avgDensity * 100).toFixed(3)}% — annotations may be too subtle`,
    severity: avgDensity > 0.01 ? 'info' : 'warning',
  });

  // Visual continuity
  let transitionCount = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].anyAnnotation !== frames[i - 1].anyAnnotation) {
      transitionCount++;
    }
  }
  checks.push({
    name: 'Scene Transitions',
    passed: transitionCount >= 1,
    message: `${transitionCount} annotation transitions across ${frames.length} frames`,
    severity: transitionCount === 0 ? 'warning' : 'info',
  });

  return checks;
}

// ── AI multimodal verification ────────────────────────────────────────────

async function runMultimodalVerification(framePaths: string[], apiKey: string): Promise<MultimodalVerification> {
  const openai = new OpenAI({ apiKey });
  const sample = framePaths.slice(0, Math.min(framePaths.length, 4));

  const images: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = await Promise.all(
    sample.map(async (fp) => {
      const base64 = (await sharp(fp).resize({ width: 960 }).png().toBuffer()).toString('base64');
      return { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${base64}` } };
    })
  );

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'You are a QA reviewer for an annotated product demo video. Each image is a frame that may contain: red/pink arrows pointing at UI elements, blue label chips with text, amber glow highlights around buttons, a small cursor, and a dimmed darkened background. Respond with JSON only, no markdown: {"frames":[{"frame":<index>,"visible":["arrow","label","glow","cursor","dim_bg"],"issues":["short note if any graphic is cut off, blurred, or unclear"],"verdict":"ok"}],"summary":"one sentence"}. Include only element types that are clearly visible.',
          },
          ...images,
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  let parsed: {
    frames?: Array<{ frame?: number; visible?: string[]; issues?: string[]; verdict?: string }>;
    summary?: string;
  } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const frames: MultimodalFrameCheck[] = (parsed.frames ?? []).map((f, i) => ({
    frameFile: sample[i]?.split('/').pop() ?? `frame-${i}`,
    frameIndex: f.frame ?? i,
    visible: f.visible ?? [],
    issues: f.issues ?? [],
    verdict: f.verdict === 'issue' ? 'issue' : 'ok',
  }));

  return { model: 'gpt-4o-mini', frames, summary: parsed.summary ?? 'No summary provided' };
}

// ── Report generation ──────────────────────────────────────────────────────

function formatReport(report: AnalysisReport): string {
  const lines: string[] = [];
  const hr = '═'.repeat(70);
  const hr2 = '─'.repeat(70);

  lines.push('');
  lines.push(hr);
  lines.push('  🎬  VIXIE VIDEO ANALYZER — COMPREHENSIVE QUALITY REPORT');
  lines.push(hr);
  lines.push('');

  lines.push('  📋 VIDEO METADATA');
  lines.push(hr2);
  lines.push(`  File:          ${report.metadata.filePath}`);
  lines.push(`  Size:          ${report.metadata.fileSizeMB} MB (${report.metadata.fileSizeBytes.toLocaleString()} bytes)`);
  lines.push(`  Duration:      ${report.metadata.durationSeconds}s`);
  lines.push(`  Resolution:    ${report.metadata.width}×${report.metadata.height}`);
  lines.push(`  Aspect Ratio:  ${report.metadata.aspectRatio}`);
  lines.push(`  Codec:         ${report.metadata.codec} (${report.metadata.profile})`);
  lines.push(`  Pixel Format:  ${report.metadata.pixelFormat}`);
  lines.push(`  Frame Rate:    ${report.metadata.frameRate} fps`);
  lines.push(`  Total Frames:  ${report.metadata.totalFrames}`);
  lines.push(`  Bitrate:       ${(report.metadata.bitRate / 1000).toFixed(0)} kbps`);
  lines.push(`  Audio:         ${report.metadata.audioCodec} @ ${report.metadata.audioSampleRate}Hz ${report.metadata.audioChannels}ch`);
  lines.push('');

  lines.push('  🔍 ANNOTATION DETECTION PER FRAME');
  lines.push(hr2);
  lines.push(`  ${'Frame'.padEnd(24)} ${'Arrow'.padEnd(12)} ${'Glow'.padEnd(12)} ${'Label'.padEnd(12)} ${'Cursor'.padEnd(10)} ${'Button'.padEnd(10)} ${'DimBg'.padEnd(10)} ${'Dens'.padEnd(8)}`);
  lines.push('  ' + '─'.repeat(68));

  for (const frame of report.frames) {
    const icon = (det: boolean) => det ? '✅' : '❌';
    lines.push(
      `  ${frame.frameFile.padEnd(22)}` +
      `${icon(frame.arrows.detected)}${frame.arrows.percentage.toFixed(2)}%`.padEnd(12) +
      `${icon(frame.glow.detected)}${frame.glow.percentage.toFixed(2)}%`.padEnd(12) +
      `${icon(frame.labels.detected)}${frame.labels.percentage.toFixed(2)}%`.padEnd(12) +
      `${icon(frame.cursor.detected)}${frame.cursor.pixelCount}px`.padEnd(12) +
      `${icon(frame.buttons.detected)}${frame.buttons.percentage.toFixed(1)}%`.padEnd(10) +
      `${icon(frame.dimBg.detected)}${frame.dimBg.percentage.toFixed(1)}%`.padEnd(10) +
      `${(frame.annotationDensity * 100).toFixed(2)}%`
    );
  }
  lines.push('');

  if (report.visualVerification.length > 0) {
    lines.push('  🎨 VISUAL VERIFICATION OVERLAYS');
    lines.push(hr2);
    for (const vp of report.visualVerification) {
      lines.push(`  📄 ${vp}`);
    }
    lines.push('');
  }

  if (report.multimodal) {
    lines.push('  🧠 AI VISION VERIFICATION');
    lines.push(hr2);
    lines.push(`  Model:         ${report.multimodal.model}`);
    for (const f of report.multimodal.frames) {
      const visible = f.visible.join(', ') || 'none';
      const issues = f.issues.length > 0 ? ` issues: ${f.issues.join('; ')}` : '';
      lines.push(`  Frame ${String(f.frameIndex).padStart(3, '0')}  ${f.verdict === 'ok' ? '✅' : '⚠️'}  visible: ${visible}${issues}`);
    }
    lines.push(`  Summary:       ${report.multimodal.summary}`);
    lines.push('');
  }

  lines.push('  ✅ QUALITY CHECKS');
  lines.push(hr2);
  for (const check of report.checks) {
    const icon = check.passed ? '✅' : check.severity === 'critical' ? '🔴' : '⚠️';
    lines.push(`  ${icon} ${check.name.padEnd(24)} ${check.message}`);
  }
  lines.push('');

  lines.push(hr2);
  const s = report.summary;
  lines.push(`  SCORE: ${s.overallScore}/100  │  ✅ ${s.passed} passed  │  ⚠️ ${s.warnings} warnings  │  🔴 ${s.failures} failed`);
  lines.push(`  VERDICT: ${s.verdict}`);
  lines.push(hr);
  lines.push('');

  return lines.join('\n');
}

// ── Main analysis entry point ──────────────────────────────────────────────

export async function analyzeVideo(
  filePath: string,
  options: { framesToExtract?: number; outputDir?: string; vision?: boolean; openaiApiKey?: string | null } = {}
): Promise<AnalysisReport> {
  const {
    framesToExtract = 10,
    outputDir = filePath.replace(/\.[^.]+$/, '') + '_analysis',
    vision: visionRequested = true,
    openaiApiKey = null,
  } = options;

  const metadata = extractMetadata(filePath);

  const framesDir = join(outputDir, 'frames');
  const verificationDir = join(outputDir, 'verification');
  mkdirSync(verificationDir, { recursive: true });

  const framePaths = extractFrames(filePath, framesDir, framesToExtract);

  const frames: AnnotationDetection[] = [];
  for (const fp of framePaths) {
    frames.push(await analyzeFramePixels(fp));
  }

  // Fill short gaps where the same annotation is present on both neighbours
  applyTemporalPersistence(frames);

  const visualVerification: string[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    try {
      const overlayPath = await createVisualOverlay(framePaths[i], frames[i], verificationDir);
      visualVerification.push(overlayPath);
    } catch {
      // Skip failed overlays
    }
  }

  let multimodal: MultimodalVerification | null = null;
  if (visionRequested && openaiApiKey) {
    const qaPaths: string[] = [];
    for (let i = 0; i < framePaths.length && qaPaths.length < 4; i++) {
      if (i === 0 || frames[i].anyAnnotation) qaPaths.push(framePaths[i]);
    }
    if (qaPaths.length === 0 && framePaths.length > 0) qaPaths.push(framePaths[0]);
    try {
      multimodal = await runMultimodalVerification(qaPaths, openaiApiKey);
      writeFileSync(join(outputDir, 'multimodal.json'), JSON.stringify(multimodal, null, 2));
    } catch {
      multimodal = null;
    }
  }

  const checks = runQualityChecks(metadata, frames);

  if (multimodal) {
    const issueFrames = multimodal.frames.filter(f => f.verdict === 'issue').length;
    checks.push({
      name: 'AI Visual QA',
      passed: issueFrames === 0,
      message: `${multimodal.frames.length - issueFrames}/${multimodal.frames.length} frames verified by vision model — ${multimodal.summary}`,
      severity: issueFrames > 0 ? 'warning' : 'info',
    });
  }

  const passed = checks.filter(c => c.passed).length;
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;
  const failures = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const totalChecks = checks.length;

  const baseScore = Math.round((passed / totalChecks) * 70);
  const annotatedFrames = frames.filter(f => f.anyAnnotation).length;
  const annotationBonus = Math.round((annotatedFrames / Math.max(frames.length, 1)) * 30);
  const overallScore = Math.min(baseScore + annotationBonus, 100);

  const verdict: 'PASS' | 'WARN' | 'FAIL' =
    failures > 0 ? 'FAIL' : warnings > totalChecks * 0.3 ? 'WARN' : 'PASS';

  const report: AnalysisReport = {
    metadata,
    frames,
    checks,
    visualVerification,
    multimodal,
    summary: { totalChecks, passed, warnings, failures, overallScore, verdict },
    timestamp: new Date().toISOString(),
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outputDir, 'report.txt'), formatReport(report));

  process.stdout.write(formatReport(report));

  return report;
}
