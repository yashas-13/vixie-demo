import sharp from 'sharp';
import type { AnnotationSpec } from '../analysis/types.js';

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M0 0 L0 24 L7 18 L12 28 L16 26 L11 16 L18 16 Z" fill="white" stroke="black" stroke-width="1.5"/>
</svg>`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function annotateFrame(
  screenshotBuffer: Buffer,
  annotation: AnnotationSpec,
  cursorPosition?: { x: number; y: number },
): Promise<Buffer> {
  const metadata = await sharp(screenshotBuffer).metadata();
  const width = metadata.width ?? 1920;
  const height = metadata.height ?? 1080;

  const overlays: Array<{ input: Buffer; top: number; left: number }> = [];

  // Dim-bg effect
  if (annotation.highlight?.style === 'dim-bg') {
    const { x, y, width: w, height: h } = annotation.highlight;
    const darkSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <mask id="cutout">
          <rect width="${width}" height="${height}" fill="white"/>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="black"/>
        </mask>
      </defs>
      <rect width="${width}" height="${height}" fill="rgba(0,0,0,0.55)" mask="url(#cutout)"/>
    </svg>`;
    overlays.push({ input: Buffer.from(darkSvg), top: 0, left: 0 });
  }

  // Glow highlight
  if (annotation.highlight?.style === 'glow') {
    const { x, y, width: w, height: h } = annotation.highlight;
    const glowSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="12"
        fill="none" stroke="#FF6B35" stroke-width="3" opacity="0.9"
        style="filter: drop-shadow(0 0 8px rgba(255,107,53,0.8))"/>
    </svg>`;
    overlays.push({ input: Buffer.from(glowSvg), top: 0, left: 0 });
  }

  // Border highlight
  if (annotation.highlight?.style === 'border') {
    const { x, y, width: w, height: h } = annotation.highlight;
    const borderSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="10"
        fill="none" stroke="#00D4FF" stroke-width="3" stroke-dasharray="8,4" opacity="0.85"/>
    </svg>`;
    overlays.push({ input: Buffer.from(borderSvg), top: 0, left: 0 });
  }

  // Arrow overlay
  if (annotation.arrow) {
    const { from, to } = annotation.arrow;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const length = Math.sqrt(dx * dx + dy * dy);
    const arrowWidth = Math.min(length * 0.6, 150);

    const arrowSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="arrowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#FF4444;stop-opacity:0.3"/>
          <stop offset="100%" style="stop-color:#FF4444;stop-opacity:1.0"/>
        </linearGradient>
      </defs>
      <g transform="translate(${from.x},${from.y}) rotate(${angle})">
        <line x1="0" y1="0" x2="${arrowWidth}" y2="0" stroke="url(#arrowGrad)" stroke-width="4" stroke-linecap="round"/>
        <polygon points="${arrowWidth},-8 ${arrowWidth + 16},0 ${arrowWidth},8" fill="#FF4444"/>
      </g>
    </svg>`;
    overlays.push({ input: Buffer.from(arrowSvg), top: 0, left: 0 });
  }

  // Label
  if (annotation.label) {
    const { text, position } = annotation.label;
    const labelWidth = text.length * 12 + 24;
    const labelSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${position.x}" y="${position.y - 28}" width="${labelWidth}" height="36"
        rx="6" fill="#1a1a2e" fill-opacity="0.9" stroke="#00D4FF" stroke-width="1"/>
      <text x="${position.x + 12}" y="${position.y}" font-family="system-ui, sans-serif"
        font-size="16" font-weight="600" fill="white">${escapeXml(text)}</text>
    </svg>`;
    overlays.push({ input: Buffer.from(labelSvg), top: 0, left: 0 });
  }

  // Cursor overlay
  if (cursorPosition) {
    overlays.push({
      input: Buffer.from(CURSOR_SVG),
      top: Math.round(cursorPosition.y),
      left: Math.round(cursorPosition.x),
    });
  }

  let image = sharp(screenshotBuffer);
  if (overlays.length > 0) {
    image = image.composite(overlays);
  }
  return image.png().toBuffer();
}
