import OpenAI from 'openai';
import type { PageFeature, AnnotationSpec, UIElement } from './types.js';
import { randomUUID } from 'crypto';

export interface AnalysisInput {
  screenshotBuffer: Buffer;
  elements: UIElement[];
  pageUrl: string;
  pageTitle: string;
}

export interface AnalysisResult {
  features: PageFeature[];
  annotations: AnnotationSpec[];
}

const FEATURE_DETECTION_PROMPT = `Analyze this screenshot of a web page. Identify the KEY features that would be important in a product demo video:

1. Hero/header section - main value proposition
2. Call-to-action buttons - primary CTAs
3. Feature showcases - key product capabilities
4. Forms - signup, contact, etc.
5. Navigation elements - menus, sidebar
6. Pricing sections
7. Social proof - testimonials, logos

For each feature, provide:
- Category (hero/cta/navigation/form/feature/pricing/testimonial/footer)
- Brief description (1 sentence)
- Bounding box coordinates (x, y, width, height) as percentage of viewport
- Importance score (0.0 to 1.0)
- Recommended annotation: arrow/highlight/zoom/circle

Return as JSON array.`;

interface VisionFeatureResponse {
  category: string;
  description: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  importance: number;
  annotationType: string;
}

export async function analyzeWithVision(
  input: AnalysisInput,
  apiKey: string,
): Promise<AnalysisResult> {
  const openai = new OpenAI({ apiKey });

  const base64Image = input.screenshotBuffer.toString('base64');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: FEATURE_DETECTION_PROMPT,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
  });

  const rawContent = response.choices[0]?.message?.content ?? '[]';
  let detected: VisionFeatureResponse[];
  try {
    const parsed = JSON.parse(rawContent);
    detected = Array.isArray(parsed) ? parsed : parsed.features ?? [];
  } catch {
    detected = [];
  }

  const features: PageFeature[] = [];
  const annotations: AnnotationSpec[] = [];

  for (const item of detected) {
    const featureId = randomUUID();
    const matchingElement = findClosestElement(item.boundingBox, input.elements, input.screenshotBuffer);

    features.push({
      id: featureId,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      element: matchingElement ?? {
        selector: `vision-${featureId}`,
        tagName: 'div',
        role: item.category,
        text: item.description,
        rect: {
          x: Math.round(item.boundingBox.x),
          y: Math.round(item.boundingBox.y),
          width: Math.round(item.boundingBox.width),
          height: Math.round(item.boundingBox.height),
        },
        isVisible: true,
        isInteractive: item.category === 'cta' || item.category === 'form',
        importance: item.importance,
      },
      category: item.category as PageFeature['category'],
      description: item.description,
      screenshotPath: '',
    });

    annotations.push({
      featureId,
      highlight: {
        x: Math.round(item.boundingBox.x),
        y: Math.round(item.boundingBox.y),
        width: Math.round(item.boundingBox.width),
        height: Math.round(item.boundingBox.height),
        style: item.annotationType === 'highlight' ? 'glow' : item.annotationType === 'zoom' ? 'border' : 'dim-bg',
      },
      zoom: item.annotationType === 'zoom'
        ? {
          x: Math.round(item.boundingBox.x + item.boundingBox.width / 2),
          y: Math.round(item.boundingBox.y + item.boundingBox.height / 2),
          scale: 1.5,
        }
        : undefined,
    });
  }

  return { features, annotations };
}

function findClosestElement(
  bbox: { x: number; y: number; width: number; height: number },
  elements: UIElement[],
  _screenshot: Buffer,
): UIElement | null {
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;

  let best: UIElement | null = null;
  let bestDist = Infinity;

  for (const el of elements) {
    const elCenterX = el.rect.x + el.rect.width / 2;
    const elCenterY = el.rect.y + el.rect.height / 2;
    const dist = Math.sqrt((centerX - elCenterX) ** 2 + (centerY - elCenterY) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }

  return bestDist < 100 ? best : null;
}
