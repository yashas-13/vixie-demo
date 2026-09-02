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

  const prompt = `Write an emotionally rich demo script for "${input.siteTitle}" (${input.siteUrl}).
Style: ${STYLE_INSTRUCTIONS[input.style]}
Target: ~${input.targetDuration} seconds total.

VOICE DIRECTIONS — Make it sound like a warm, confident human sales engineer:
- Use natural conversational phrasing with rhetorical questions (e.g. "Notice how effortless that feels?")
- Vary sentence rhythm: short punchy lines mixed with longer flowing ones
- Add emotional emphasis words and exclamations where warranted (e.g. "That's the key idea.")
- Use 1-2 dashes or pauses (…) for dramatic effect
- Speak as if guiding a curious prospect by the hand, not reciting a spec sheet

Features:
${featuresJson}

For each feature, provide:
- "narration": 1-2 sentences (~10-12 seconds of speech), emotional and conversational
- "emotion": "warm" | "energetic" | "calm" | "dramatic"
- "durationSeconds": 12-15
- "visual": "zoom-in" | "highlight" | "scroll-to" | "static"
- "transition": "fade" | "slide" | "cut"

Also provide "intro" (1-2 sentences, warm opener), "outro" (1-2 sentences, confident closer), and "title".

Return JSON: { "title", "intro", "outro", "segments": [{ "featureId", "narration", "emotion", "durationSeconds", "visual", "transition" }] }`;

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
      emotion: (['warm', 'energetic', 'calm', 'dramatic'] as const).includes(s.emotion) ? s.emotion : 'warm',
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
    intro: parsed.intro ?? `Welcome to ${input.siteTitle}. Let me walk you through what makes it special.`,
    outro: parsed.outro ?? `That's ${input.siteTitle} in action. Reach out and we'll tailor it to your workflow.`,
    emotion: parsed.emotion ?? 'warm',
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
      emotion: 'warm',
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
    intro: `Welcome to ${input.siteTitle}. Let me walk you through what makes it special.`,
    outro: `That's ${input.siteTitle} in a nutshell. If this resonates, let's talk.`,
    emotion: 'warm',
  };
}

function generateFallbackNarration(feature: PageFeature): string {
  const desc = feature.description;
  const shorter = desc.length > 45 ? desc.slice(0, 45) + '...' : desc;

  const templates: Record<string, string[]> = {
    hero: [
      `Right away you're greeted by a bold, confident opening — ${shorter}. It instantly sets the tone and pulls you in.`,
      `The first thing you'll notice is a clean, striking hero — ${shorter}. And honestly, it makes a great first impression.`,
    ],
    cta: [
      `Now here's the action we care about — ${shorter}. One click, and the customer is on their way. That's the moment it all comes together.`,
      `This call-to-action is the heartbeat of the page: ${shorter}. It makes taking the next step feel effortless.`,
    ],
    form: [
      `Here's the signup flow — ${shorter}. Notice how clean it is. No friction, no confusion... just a smooth path forward.`,
      `This is where visitors become users — ${shorter}. It's clear, simple, and genuinely easy to use.`,
    ],
    feature: [
      `This is a capability that really stands out — ${shorter}. For your team, this could be a real game-changer.`,
      `Look closely at this — ${shorter}. It's one of those details that separates a good product from a great one.`,
    ],
    pricing: [
      `And here's the pricing — ${shorter}. Whether you're just starting or scaling up, there's a plan that fits.`,
      `Pricing is refreshingly simple: ${shorter}. No hidden surprises... just clear value at every level.`,
    ],
    navigation: [
      `The navigation keeps everything within reach — ${shorter}. It's intuitive, so users never feel lost.`,
      `Getting around is effortless — ${shorter}. Everything you need is right where you'd expect it.`,
    ],
    testimonial: [
      `And hear what real users are saying — ${shorter}. That kind of trust is exactly what you want to see.`,
      `Social proof like this speaks volumes — ${shorter}. When customers rave about it, you know it delivers.`,
    ],
    heading: [
      `And this headline really lands — ${desc}. It sums up the whole promise in a glance.`,
      `${desc} — that's the core idea, and it's compelling.`,
    ],
    other: [
      `Here's something worth your attention — ${desc}.`,
      `Take a look at this — ${desc}. It's a detail that really matters.`,
    ],
  };

  const key = feature.category + ':' + feature.element?.rect?.x + ':' + feature.element?.rect?.y;
  const options = templates[feature.category] ?? templates.other;
  // Deterministic pick based on position so the same element always reads the same
  let hash = 0;
  for (const ch of key) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const idx = Math.abs(hash) % options.length;
  return options[idx];
}
