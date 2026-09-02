export interface Point {
  x: number;
  y: number;
}

export function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

export function generateCursorPath(
  from: Point,
  to: Point,
  steps: number = 30,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(dist * 0.3, 150);

  const cp1: Point = {
    x: from.x + dx * 0.25 + (Math.random() - 0.5) * curvature,
    y: from.y + dy * 0.25 - curvature * 0.5,
  };
  const cp2: Point = {
    x: from.x + dx * 0.75 + (Math.random() - 0.5) * curvature,
    y: from.y + dy * 0.75 - curvature * 0.3,
  };

  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    points.push(cubicBezier(from, cp1, cp2, to, eased));
  }
  return points;
}
