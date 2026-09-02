/**
 * Prosody Engine — adds emotional expressiveness to flat narration text.
 *
 * Splits text into sentence chunks, assigns per-chunk rate/pitch/volume
 * based on sentence type (exclamation, question, emphasis, calm).
 * Also inserts natural breathing pauses (breaks) between major sections.
 */

export interface ProsodyChunk {
  text: string;
  rate: string;   // e.g. "-5%", "+10%"
  pitch: string;  // e.g. "+2Hz", "-1Hz"
  volume: string; // e.g. "+0%", "+5%"
}

export interface ProsodyOptions {
  baseRate: string;     // default rate
  basePitch: string;    // default pitch
  baseVolume: string;   // default volume
  emotion: 'warm' | 'energetic' | 'calm' | 'dramatic';
}

const EMOTION_PRESETS: Record<ProsodyOptions['emotion'], {
  rateScale: number;
  pitchBase: number;
  volumeBoost: number;
}> = {
  warm:        { rateScale: 0,   pitchBase: 0,   volumeBoost: 0 },
  energetic:   { rateScale: 5,   pitchBase: 1,   volumeBoost: 3 },
  calm:        { rateScale: -3,  pitchBase: -1,  volumeBoost: -2 },
  dramatic:    { rateScale: -2,  pitchBase: 0,   volumeBoost: 2 },
};

/**
 * Analyze a sentence and return its prosody parameters
 * based on punctuation, keywords, and position in the narration.
 */
function analyzeSentence(
  sentence: string,
  sentenceIndex: number,
  totalSentences: number,
  emotion: ProsodyOptions['emotion'],
): { rate: string; pitch: string; volume: string } {
  const preset = EMOTION_PRESETS[emotion];
  const trimmed = sentence.trim();

  // Detect sentence type
  const isExclamation = /[!]$/.test(trimmed);
  const isQuestion = /[?]$/.test(trimmed);
  const isEmphasis = /\b(key|important|notice|remember|crucial|essential|powerful|beautiful|seamless|intelligent|innovative)\b/i.test(trimmed);
  const isIntro = sentenceIndex === 0;
  const isConclusion = sentenceIndex >= totalSentences - 2;
  const hasPause = /\.{3}|…|—/.test(trimmed);

  let rateDelta = preset.rateScale;
  let pitchDelta = preset.pitchBase;
  let volumeDelta = preset.volumeBoost;

  // Sentence-type adjustments
  if (isExclamation) {
    rateDelta += 8;     // slightly faster — excitement
    pitchDelta += 3;    // higher pitch — energy
    volumeDelta += 4;   // louder — emphasis
  } else if (isQuestion) {
    rateDelta -= 2;     // slightly slower — thoughtful
    pitchDelta += 2;    // rising inflection feel
    volumeDelta += 1;
  } else if (isEmphasis) {
    rateDelta -= 6;     // slower — let it sink in
    pitchDelta += 1;
    volumeDelta += 3;
  } else if (isIntro) {
    rateDelta -= 4;     // measured opening
    pitchDelta += 1;
    volumeDelta += 2;
  } else if (isConclusion) {
    rateDelta -= 3;     // warm wrap-up
    pitchDelta -= 1;
    volumeDelta += 1;
  }

  if (hasPause) {
    rateDelta -= 4; // slow down around pauses
  }

  // Clamp values
  rateDelta = Math.max(-20, Math.min(25, rateDelta));
  pitchDelta = Math.max(-5, Math.min(5, pitchDelta));
  volumeDelta = Math.max(-10, Math.min(10, volumeDelta));

  const rateSign = rateDelta >= 0 ? '+' : '';
  const pitchSign = pitchDelta >= 0 ? '+' : '';
  const volumeSign = volumeDelta >= 0 ? '+' : '';

  return {
    rate: `${rateSign}${rateDelta}%`,
    pitch: `${pitchSign}${pitchDelta}Hz`,
    volume: `${volumeSign}${volumeDelta}%`,
  };
}

/**
 * Split text into sentences, preserving natural break points.
 */
function splitSentences(text: string): string[] {
  // Split on sentence boundaries but keep the punctuation
  const raw = text
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter(s => s.trim().length > 0);

  return raw;
}

/**
 * Convert flat narration text into prosody chunks with per-sentence emotion.
 */
export function applyProsody(
  text: string,
  options: Partial<ProsodyOptions> = {},
): ProsodyChunk[] {
  const opts: ProsodyOptions = {
    baseRate: '+0%',
    basePitch: '+0Hz',
    baseVolume: '+0%',
    emotion: 'warm',
    ...options,
  };

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return [{
      text,
      rate: opts.baseRate,
      pitch: opts.basePitch,
      volume: opts.baseVolume,
    }];
  }

  const chunks: ProsodyChunk[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const prosody = analyzeSentence(sentence, i, sentences.length, opts.emotion);

    chunks.push({
      text: sentence.trim(),
      rate: prosody.rate,
      pitch: prosody.pitch,
      volume: prosody.volume,
    });

    // Add a natural breathing pause after major sections (not after every sentence)
    if (i < sentences.length - 1) {
      const nextSentence = sentences[i + 1] ?? '';
      const isMajorBreak =
        /[:;]$/.test(sentence) ||
        /\.{3}|…/.test(sentence) ||
        /^(Now|Next|Then|So|And|But|Finally|Let)/.test(nextSentence.trim());
      if (isMajorBreak) {
        chunks.push({ text: '', rate: '+0%', pitch: '+0Hz', volume: '+0%' });
      }
    }
  }

  return chunks;
}

/**
 * Generate natural intro/outro with breathing pauses.
 */
export function enhanceIntroOutro(text: string, emotion: ProsodyOptions['emotion'] = 'warm'): string {
  const enhanced = text
    .replace(/([.!?])\s+/g, '$1 ... ')  // add breathing pause after sentences
    .replace(/\.$/, '...');              // trailing pause for outro feel
  return enhanced;
}
