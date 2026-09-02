import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { UIElement, PageInfo, SiteManifest } from '../analysis/types.js';
import type { VixieConfig } from '../utils/config.js';

export interface CrawlResult {
  manifest: SiteManifest;
  screenshots: Map<string, Buffer>;
}

function getChromePath(): string {
  const paths = [
    process.env.CHROME_PATH,
    '/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',
    '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_PATH env var or install: npx playwright install chromium');
}

export async function crawlWebsite(
  config: VixieConfig,
  outputDir: string,
): Promise<CrawlResult> {
  const screenshotsDir = join(outputDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  const chromePath = getChromePath();
  console.log(`  Using Chrome: ${chromePath}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const isShorts = config.format === 'shorts';
  const viewWidth = isShorts ? config.resolutionDimensions.width : config.resolutionDimensions.width;
  const viewHeight = isShorts ? 800 : config.resolutionDimensions.height; // tall viewport for scroll detection

  const context = await browser.newContext({
    viewport: { width: viewWidth, height: viewHeight },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const screenshots = new Map<string, Buffer>();
  const pages: PageInfo[] = [];

  await page.goto(config.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const siteTitle = await page.title();
  const visitedUrls = new Set<string>();
  const urlsToVisit = [config.url];
  let pageCount = 0;

  while (urlsToVisit.length > 0 && pageCount < config.maxPages) {
    const url = urlsToVisit.shift()!;
    if (visitedUrls.has(url)) continue;
    visitedUrls.add(url);
    pageCount++;

    if (pageCount > 1) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
    }

    console.log(`  📸 Capturing page ${pageCount}: ${url}`);

    const screenshotKey = `page-${pageCount}`;
    const isShorts = config.format === 'shorts';
    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: isShorts });
    screenshots.set(screenshotKey, screenshotBuffer);
    writeFileSync(join(screenshotsDir, `${screenshotKey}.png`), screenshotBuffer);

    // Extract interactive elements via DOM
    const rawElements: Array<{
      tag: string;
      text: string;
      rect: { x: number; y: number; width: number; height: number };
      role: string;
    }> = await page.evaluate(() => {
      const results: Array<{
        tag: string;
        text: string;
        rect: { x: number; y: number; width: number; height: number };
        role: string;
      }> = [];

      const selectors = [
        'button', 'a[href]', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]',
        'nav a', '[class*="btn"]', '[class*="button"]', '[class*="cta"]',
      ];

      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el: Element) => {
          const htmlEl = el as HTMLElement;
          const text = htmlEl.textContent?.trim().substring(0, 100) ?? '';
          if (!text || text.length === 0) return;
          const rect = htmlEl.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (rect.y > 5000) return;
          results.push({
            tag: htmlEl.tagName.toLowerCase(),
            text,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            role: htmlEl.getAttribute('role') ?? '',
          });
        });
      }

      // Detect key content sections
      document.querySelectorAll('h1, h2, h3, [class*="hero"], [class*="pricing"], [class*="feature"], [class*="testimonial"]').forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const text = htmlEl.textContent?.trim().substring(0, 100) ?? '';
        if (!text) return;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.y > 5000) return;
        const cls = htmlEl.className?.toString() ?? '';
        results.push({
          tag: htmlEl.tagName.toLowerCase(),
          text,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          role: cls.includes('hero') ? 'hero'
            : cls.includes('pricing') ? 'pricing'
            : cls.includes('feature') ? 'feature'
            : cls.includes('testimonial') ? 'testimonial'
            : htmlEl.tagName.startsWith('H') ? 'heading'
            : 'other',
        });
      });

      return results;
    });

    const uiElements: UIElement[] = rawElements.map((el: any, i: number) => ({
      selector: `${el.tag}-${i}`,
      tagName: el.tag,
      role: el.role || categorizeElement(el.text, el.tag),
      text: el.text,
      rect: el.rect,
      isVisible: true,
      isInteractive: el.tag === 'button' || el.tag === 'a' || el.tag === 'input',
      importance: el.tag === 'a' && el.text.length > 0 ? 0.8 : 0.5,
    }));

    pages.push({
      url,
      title: await page.title(),
      screenshotPath: join(screenshotsDir, `${screenshotKey}.png`),
      elements: uiElements,
    });

    console.log(`  Found ${uiElements.length} elements on page`);

    // Discover more pages
    const links: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(href => {
          try {
            const u = new URL(href);
            return u.origin === window.location.origin && !href.includes('#');
          } catch { return false; }
        });
    });

    const uniqueLinks = [...new Set(links)];
    for (const link of uniqueLinks.slice(0, 8)) {
      if (!visitedUrls.has(link)) urlsToVisit.push(link);
    }
  }

  await browser.close();

  return {
    manifest: {
      url: config.url,
      title: siteTitle,
      pages,
      features: [],
      annotations: [],
    },
    screenshots,
  };
}

function categorizeElement(text: string, tag: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('sign up') || lower.includes('get started') || lower.includes('try') || lower.includes('start') || lower.includes('request'))
    return 'cta';
  if (tag === 'nav' || lower.includes('nav') || lower.includes('menu'))
    return 'navigation';
  if (tag === 'form' || tag === 'input' || lower.includes('email') || lower.includes('subscribe'))
    return 'form';
  if (lower.includes('price') || lower.includes('plan') || lower.includes('/mo'))
    return 'pricing';
  if (lower.includes('hero') || lower.includes('power') || lower.includes('infrastructure'))
    return 'hero';
  if (lower.includes('testimonial') || lower.includes('review') || lower.includes('loved by'))
    return 'testimonial';
  return 'feature';
}
