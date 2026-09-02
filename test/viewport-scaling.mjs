import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const { RESOLUTION_MAP, DEFAULT_CONFIG, resolveConfig } = await import(join(distDir, 'utils', 'config.js'));
const { annotateFrame } = await import(join(distDir, 'annotations', 'compositor.js'));

describe('RESOLUTION_MAP', () => {
  it('720p is 1280x720', () => {
    assert.deepEqual(RESOLUTION_MAP['720p'], { width: 1280, height: 720 });
  });
  it('1080p is 1920x1080', () => {
    assert.deepEqual(RESOLUTION_MAP['1080p'], { width: 1920, height: 1080 });
  });
  it('4K is 3840x2160', () => {
    assert.deepEqual(RESOLUTION_MAP['4K'], { width: 3840, height: 2160 });
  });
});

describe('DEFAULT_CONFIG', () => {
  it('resolutionDimensions matches 1080p', () => {
    assert.deepEqual(DEFAULT_CONFIG.resolutionDimensions, { width: 1920, height: 1080 });
  });
});

describe('resolveConfig', () => {
  it('720p sets resolutionDimensions to 1280x720', () => {
    const cfg = resolveConfig({ resolution: '720p' }, 'https://example.com');
    assert.deepEqual(cfg.resolutionDimensions, { width: 1280, height: 720 });
  });
  it('1080p sets resolutionDimensions to 1920x1080', () => {
    const cfg = resolveConfig({ resolution: '1080p' }, 'https://example.com');
    assert.deepEqual(cfg.resolutionDimensions, { width: 1920, height: 1080 });
  });
  it('4K sets resolutionDimensions to 3840x2160', () => {
    const cfg = resolveConfig({ resolution: '4K' }, 'https://example.com');
    assert.deepEqual(cfg.resolutionDimensions, { width: 3840, height: 2160 });
  });
  it('url is set', () => {
    const cfg = resolveConfig({}, 'https://test.com');
    assert.equal(cfg.url, 'https://test.com');
  });
});

describe('annotateFrame preserves dimensions', () => {
  it('output matches input dimensions', async () => {
    const testDir = join(__dirname, '.test-out');
    mkdirSync(testDir, { recursive: true });
    try {
      const testPng = sharp({
        create: { width: 1280, height: 720, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 1 } }
      }).png();
      const buf = await testPng.toBuffer();

      const annotated = await annotateFrame(buf, {
        featureId: 'test',
        highlight: { x: 100, y: 100, width: 200, height: 50, style: 'glow' },
      });

      const meta = await sharp(annotated).metadata();
      assert.equal(meta.width, 1280, 'output width must be 1280');
      assert.equal(meta.height, 720, 'output height must be 720');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('output matches input dimensions at 1920x1080', async () => {
    const buf = await sharp({
      create: { width: 1920, height: 1080, channels: 4, background: { r: 50, g: 50, b: 50, alpha: 1 } }
    }).png().toBuffer();

    const annotated = await annotateFrame(buf, {
      featureId: 'test',
      arrow: { from: { x: 100, y: 100 }, to: { x: 300, y: 200 } },
    });

    const meta = await sharp(annotated).metadata();
    assert.equal(meta.width, 1920, 'output width must be 1920');
    assert.equal(meta.height, 1080, 'output height must be 1080');
  });
});
