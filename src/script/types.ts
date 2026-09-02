export type DemoStyle = 'professional' | 'casual' | 'technical';

export interface ScriptSegment {
  id: string;
  featureId: string;
  narration: string;
  durationSeconds: number;
  visual: VisualDirection;
  transition: 'fade' | 'slide' | 'cut' | 'zoom';
  emotion?: 'warm' | 'energetic' | 'calm' | 'dramatic';
}

export interface VisualDirection {
  action: 'zoom-in' | 'zoom-out' | 'pan' | 'highlight' | 'click' | 'scroll-to' | 'static';
  target?: { x: number; y: number; width: number; height: number };
  cursorPath?: { x: number; y: number }[];
  annotationType?: 'arrow' | 'circle' | 'highlight' | 'label';
}

export interface DemoScript {
  title: string;
  style: DemoStyle;
  totalDurationSeconds: number;
  segments: ScriptSegment[];
  intro: string;
  outro: string;
  emotion?: 'warm' | 'energetic' | 'calm' | 'dramatic';
}
