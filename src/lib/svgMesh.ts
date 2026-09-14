/* ============================================================
   SVG → 3D MESH — converts the original SVG artwork into real
   extruded geometry (no stacked-div fake extrusion).
   Stage: SVG 135×135 units mapped to a 7-unit world, centered.
   ============================================================ */
import * as THREE from "three";

export const SVG_CENTER = { x: 67.7, y: 71.5 };
export const WORLD_SIZE = 7;
export const S = WORLD_SIZE / 135;

export function svgToWorld(x: number, y: number): [number, number] {
  return [(x - SVG_CENTER.x) * S, -(y - SVG_CENTER.y) * S];
}

/** Arrow vertices in SVG space (absolute, derived from original `d`) */
const ARROW_SVG: Array<[number, number]> = [
  [64.7, 30.6],
  [64.7, 54.6],
  [59.62, 54.6],
  [67.7, 68.6],
  [75.78, 54.6],
  [70.7, 54.6],
  [70.6997, 30.6],
  [64.7097, 30.6],
];

export const OUTLINE_D =
  "M51.9 11.9h31.7l3.07 11.4.944.391c19.4 8.03 32 26.9 32 47.9 0 2.26-.149 4.53-.445 6.77l-.133 1.01 8.37 8.37-15.8 27.4-11.4-3.06-.809.623c-9.06 6.95-20.2 10.7-31.6 10.7-11.4 6e-5-22.5-3.77-31.6-10.7l-.81-.623-11.4 3.06-15.8-27.4 8.37-8.37-.133-1.01c-.296-2.25-.445-4.51-.445-6.77.000141-21 12.6-39.9 32-47.9l.944-.391z";

export interface ExtrudeOpts {
  depth: number;
  bevel: number;
}

export function buildArrowGeometry(opts: ExtrudeOpts): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  ARROW_SVG.forEach(([x, y], i) => {
    const [wx, wy] = svgToWorld(x, y);
    if (i === 0) shape.moveTo(wx, wy);
    else shape.lineTo(wx, wy);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth,
    bevelEnabled: opts.bevel > 0.001,
    bevelThickness: opts.bevel,
    bevelSize: opts.bevel * 0.7,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, -opts.depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Ring from the stroked circle (r=33, stroke 6) → flat ring extruded */
export function buildRingGeometry(opts: ExtrudeOpts): THREE.ExtrudeGeometry {
  const outer = (33 + 3) * S;
  const inner = (33 - 3) * S;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth * 0.82,
    bevelEnabled: opts.bevel > 0.001,
    bevelThickness: opts.bevel,
    bevelSize: opts.bevel * 0.7,
    bevelSegments: 2,
    curveSegments: 128,
  });
  geo.translate(0, 0, (-opts.depth * 0.82) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Sample an SVG path's stroke centerline using the browser's own path engine */
export function sampleSvgPath(d: string, samples = 420): Array<[number, number]> {
  try {
    const NS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(NS, "path") as SVGPathElement;
    path.setAttribute("d", d);
    // must be in DOM for getPointAtLength in some browsers
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    svg.appendChild(path);
    document.body.appendChild(svg);
    const len = path.getTotalLength();
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < samples; i++) {
      const pt = path.getPointAtLength((i / samples) * len);
      pts.push([pt.x, pt.y]);
    }
    document.body.removeChild(svg);
    return pts;
  } catch {
    // fallback: rounded blob
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const r = 52 + Math.sin(a * 3) * 6;
      pts.push([SVG_CENTER.x + Math.cos(a) * r, SVG_CENTER.y + Math.sin(a) * r * 0.96]);
    }
    return pts;
  }
}

/** Outline stroke (width 4) → tube swept along the sampled centerline */
export function buildOutlineGeometry(tubeScale = 1): THREE.TubeGeometry {
  const pts2 = sampleSvgPath(OUTLINE_D, 460);
  const pts3 = pts2.map(([x, y]) => {
    const [wx, wy] = svgToWorld(x, y);
    return new THREE.Vector3(wx, wy, 0);
  });
  const curve = new THREE.CatmullRomCurve3(pts3, true, "catmullrom", 0.08);
  const radius = 2 * S * tubeScale; // stroke-width 4 → radius 2px
  const geo = new THREE.TubeGeometry(curve, 460, radius, 10, true);
  geo.computeVertexNormals();
  return geo;
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
