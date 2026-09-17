/* ============================================================
   ANIM CURVES — faithful ports of the original CSS keyframes
   orbit 9s | bob 9s | flip 6s alternate | throb 12s
   ============================================================ */

export const ORBIT_PERIOD = 9;
export const BOB_PERIOD = 9;
export const FLIP_PERIOD = 6;
export const THROB_PERIOD = 12;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** smoothstep interpolation */
function sstep(t: number) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

/** back ease-in-out w/ overshoot — mimics cubic-bezier(1.72,-.74,.86,.28) wind-up */
function backInOut(t: number, s = 1.70158): number {
  t = clamp01(t);
  const c2 = s * 1.525;
  if (t < 0.5) {
    const u = 2 * t;
    return (Math.pow(u, 2) * ((c2 + 1) * u - c2)) / 2;
  }
  const u = 2 * t - 2;
  return (Math.pow(u, 2) * ((c2 + 1) * u + c2) + 2) / 2;
}

/* windUp function removed */

/* ---------------- ORBIT: 0 → 120 → 240 → 360 (deg) ----------------
   0%,10% => 0 | 33.333%,43.333% => 120 | 66.667%,76.667% => 240 | 100% => 360 */
export function orbitAngleDeg(timeSec: number): number {
  const p = ((timeSec % ORBIT_PERIOD) + ORBIT_PERIOD) % ORBIT_PERIOD / ORBIT_PERIOD;
  const segs: Array<[number, number, number, number]> = [
    [0.0, 0.1, 0, 0],
    [0.1, 0.33333, 0, 120],
    [0.33333, 0.43333, 120, 120],
    [0.43333, 0.66667, 120, 240],
    [0.66667, 0.76667, 240, 240],
    [0.76667, 0.99999, 240, 360],
  ];
  for (const [a, b, v0, v1] of segs) {
    if (p >= a && p <= b) {
      if (v0 === v1) return v0;
      const local = (p - a) / (b - a);
      return v0 + (v1 - v0) * backInOut(local, 1.35);
    }
  }
  return 360;
}

/* ---------------- BOB: translateY(px svg) + scaleY ---------------- */
interface BobKey {
  t: number;
  y: number;
  sy: number;
}
const BOB_KEYS: BobKey[] = [
  { t: 0.0, y: 0, sy: 1 },
  { t: 0.5, y: -8, sy: 1.02 },
  { t: 1.0, y: 0, sy: 1 },
];

export function bobTransform(timeSec: number): { y: number; sy: number } {
  const p = ((timeSec % BOB_PERIOD) + BOB_PERIOD) % BOB_PERIOD / BOB_PERIOD;
  for (let i = 0; i < BOB_KEYS.length - 1; i++) {
    const a = BOB_KEYS[i];
    const b = BOB_KEYS[i + 1];
    if (p >= a.t && p <= b.t) {
      const span = b.t - a.t;
      const local = span <= 0 ? 0 : (p - a.t) / span;
      const e = sstep(local);
      return { y: a.y + (b.y - a.y) * e, sy: a.sy + (b.sy - a.sy) * e };
    }
  }
  return { y: 0, sy: 1 };
}

/* ---------------- FLIP: removed to calm the idle state ---------------- */
export function flipScaleX(_timeSec: number): number {
  return 1;
}

/* ---------------- THROB: uniform scale ----------------
   0%,50%,100% => .99 | 10%,90% => 1.01 | 25%,75% => 1.03 */
export function throbScale(timeSec: number): number {
  const p = (((timeSec % THROB_PERIOD) + THROB_PERIOD) % THROB_PERIOD) / THROB_PERIOD;
  const keys: Array<[number, number]> = [
    [0.0, 0.99],
    [0.1, 1.01],
    [0.25, 1.03],
    [0.5, 0.99],
    [0.75, 1.03],
    [0.9, 1.01],
    [1.0, 0.99],
  ];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, va] = keys[i];
    const [tb, vb] = keys[i + 1];
    if (p >= ta && p <= tb) {
      const local = (p - ta) / (tb - ta);
      return va + (vb - va) * sstep(local);
    }
  }
  return 0.99;
}

/** camera orbit angle (radians), 12s loop */
export function cameraOrbitRad(timeSec: number, speed = 1) {
  return (timeSec * speed * Math.PI * 2) / 12;
}

export const SVG_PX_TO_WORLD = 7 / 135; // world units per svg px (7-unit stage)
