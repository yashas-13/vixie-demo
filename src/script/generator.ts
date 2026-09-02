import OpenAI from 'openai';
import type { PageFeature, AnnotationSpec } from '../analysis/types.js';
import type { DemoScript, ScriptSegment, DemoStyle } from './types.js';
import { estimateSpeechDuration } from '../utils/timing.js';
import { randomUUID } from 'crypto';

const STYLE_INSTRUCTIONS: Record<DemoStyle, string> = {
  professional: 'Speak as a confident product specialist. Use clear, benefit-focused language.',
  casual: 'Speak like a friendly colleague showing something cool. Conversational tone.',
  technical: 'Speak as a technical architect. Precise, detail-rich language.',
};

const MAX_SEGMENTS = 8;

interface ScriptInput {
  features: PageFeature[];
  annotations: AnnotationSpec[];
  siteUrl: string;
  siteTitle: string;
  style: DemoStyle;
  targetDuration: number;
}

export async function generateScript(
  input: ScriptInput,
  apiKey: string | null,
): Promise<DemoScript> {
  // Cap features to most important ones
  const cappedFeatures = selectTopFeatures(input.features, MAX_SEGMENTS);
  const cappedAnnotations = input.annotations.filter(a =>
    cappedFeatures.some(f => f.id === a.featureId),
  );

  const cappedInput = { ...input, features: cappedFeatures, annotations: cappedAnnotations };

  if (apiKey) {
    return generateWithAI(cappedInput, apiKey);
  }
  return generateFallback(cappedInput);
}

function selectTopFeatures(features: PageFeature[], maxCount: number): PageFeature[] {
  // Group by category and prioritize
  const priority: Record<string, number> = {
    hero: 1,
    cta: 2,
    feature: 3,
    pricing: 4,
    form: 5,
    navigation: 6,
    testimonial: 7,
    other: 8,
    footer: 9,
  };

  const sorted = [...features].sort((a, b) => {
    const pa = priority[a.category] ?? 5;
    const pb = priority[b.category] ?? 5;
    if (pa !== pb) return pa - pb;
    return b.element.importance - a.element.importance;
  });

  // Deduplicate by category (max 2 per category)
  const categoryCount = new Map<string, number>();
  const selected: PageFeature[] = [];

  for (const f of sorted) {
    const count = categoryCount.get(f.category) ?? 0;
    if (count < 2 && selected.length < maxCount) {
      selected.push(f);
      categoryCount.set(f.category, count + 1);
    }
  }

  return selected;
}

async function generateWithAI(input: ScriptInput, apiKey: string): Promise<DemoScript> {
  const openai = new OpenAI({ apiKey });

  const featuresJson = JSON.stringify(
    input.features.map(f => ({
      id: f.id,
      category: f.category,
      description: f.description,
      pageTitle: f.pageTitle,
    })),
    null,
    2,
  );

  const prompt = `Write a demo script for "${input.siteTitle}" (${input.siteUrl}).
Style: ${STYLE_INSTRUCTIONS[input.style]}
Target: ~${input.targetDuration} seconds total.

Features:
${featuresJson}

For each feature, provide:
- "narration": 1-2 sentences (~10-12 seconds of speech)
- "durationSeconds": 12-15
- "visual": "zoom-in" | "highlight" | "scroll-to" | "static"
- "transition": "fade" | "slide" | "cut"

Also provide "intro" (1 sentence), "outro" (1 sentence), and "title".

Return JSON: { "title", "intro", "outro", "segments": [{ "featureId", "narration", "durationSeconds", "visual", "transition" }] }`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content);

  const segments: ScriptSegment[] = (parsed.segments ?? []).slice(0, MAX_SEGMENTS).map(
    (s: any, i: number) => ({
      id: randomUUID(),
      featureId: s.featureId ?? input.features[i]?.id ?? `seg-${i}`,
      narration: s.narration ?? '',
      durationSeconds: Math.max(Math.min(s.durationSeconds ?? 12, 15), 8),
      visual: { action: s.visual ?? 'static', annotationType: 'highlight' as const },
      transition: s.transition ?? 'fade',
    }),
  );

  const totalDuration = segments.reduce((sum, s) => sum + s.durationSeconds, 0);

  return {
    title: parsed.title ?? input.siteTitle,
    style: input.style,
    totalDurationSeconds: totalDuration,
    segments,
    intro: parsed.intro ?? `Welcome to ${input.siteTitle}.`,
    outro: parsed.outro ?? `Visit ${input.siteUrl} to learn more.`,
  };
}

function generateFallback(input: ScriptInput): DemoScript {
  const segments: ScriptSegment[] = input.features.map((f, i) => {
    const narration = generateFallbackNarration(f);
    const duration = Math.min(Math.max(estimateSpeechDuration(narration) / 1000 + 2, 8), 15);

    return {
      id: randomUUID(),
      featureId: f.id,
      narration,
      durationSeconds: duration,
      visual: {
        action: f.category === 'cta' ? 'zoom-in' : f.category === 'hero' ? 'pan' : 'highlight',
        target: f.element.rect,
        annotationType: f.category === 'cta' ? 'arrow' : 'highlight',
      },
      transition: i === 0 ? 'fade' : 'slide',
    };
  });

  return {
    title: input.siteTitle,
    style: input.style,
    totalDurationSeconds: segments.reduce((sum, s) => sum + s.durationSeconds, 0),
    segments,
    intro: `Welcome to ${input.siteTitle}. Let me show you around.`,
    outro: `Thanks for visiting ${input.siteTitle}.`,
  };
}

function generateFallbackNarration(feature: PageFeature): string {
  const templates: Record<string, string[]> = {
    hero: [
      `Here's the main hero section. ${feature.description}`,
      `The homepage opens with: ${feature.description}`,
    ],
    cta: [
      `Notice this call-to-action: ${feature.description}. It guides users to take the next step.`,
      `This key action button: ${feature.description}.`,
    ],
    form: [
      `Here's the signup form. ${feature.description}. Clean and easy to use.`,
    ],
    feature: [
      `This feature: ${feature.description}. A key capability of the product.`,
    ],
    pricing: [
      `Pricing: ${feature.description}. Plans for every need.`,
    ],
    navigation: [
      `The navigation: ${feature.description}. Easy to explore.`,
    ],
    testimonial: [
      `Social proof: ${feature.description}. Users love it.`,
    ],
    other: [feature.description],
  };

  const options = templates[feature.category] ?? templates.other;
  return options[Math.floor(Math.random() * options.length)];
}
