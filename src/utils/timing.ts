export interface TimedSegment {
  startMs: number;
  endMs: number;
  featureId: string;
}

export function syncAudioVisual(
  segmentDurationsMs: number[],
  gapMs: number = 300,
): TimedSegment[] {
  const result: TimedSegment[] = [];
  let current = 0;
  for (let i = 0; i < segmentDurationsMs.length; i++) {
    result.push({
      startMs: current,
      endMs: current + segmentDurationsMs[i],
      featureId: `segment-${i}`,
    });
    current += segmentDurationsMs[i] + gapMs;
  }
  return result;
}

export function estimateSpeechDuration(text: string, wordsPerMinute: number = 160): number {
  const words = text.trim().split(/\s+/).length;
  return (words / wordsPerMinute) * 60000;
}
