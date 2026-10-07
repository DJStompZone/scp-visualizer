/* ============================================================
   POKEBALL SVG → 3D MESH
   ============================================================ */
import * as THREE from "three";

export const POKE_CENTER = { x: 297.6, y: 297 };
export const WORLD_SIZE = 7;
// Base radius in SVG is 245. We map 245 -> WORLD_SIZE / 2
export const S = (WORLD_SIZE / 2) / 245;

export function svgToWorld(x: number, y: number): [number, number] {
  return [(x - POKE_CENTER.x) * S, -(y - POKE_CENTER.y) * S];
}

export interface ExtrudeOpts {
  depth: number;
  bevel: number;
}

// Builds a perfect semi-circle (top or bottom)
export function buildHalfDome(opts: ExtrudeOpts, isTop: boolean): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const radius = 245 * S;
  
  if (isTop) {
    // Top half: path goes from left to right over the top
    shape.moveTo(-radius, 0);
    shape.absarc(0, 0, radius, Math.PI, 0, true);
    shape.lineTo(-radius, 0);
  } else {
    // Bottom half: path goes from right to left under the bottom
    shape.moveTo(radius, 0);
    shape.absarc(0, 0, radius, 0, Math.PI, true);
    shape.lineTo(radius, 0);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth,
    bevelEnabled: opts.bevel > 0.001,
    bevelThickness: opts.bevel,
    bevelSize: opts.bevel * 0.7,
    bevelSegments: 2,
    curveSegments: 32,
  });
  geo.translate(0, 0, -opts.depth / 2);
  geo.computeVertexNormals();
  return geo;
}

// Builds the flat circular background plate (mechanical-core)
export function buildCorePlate(opts: ExtrudeOpts): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 240 * S, 0, Math.PI * 2, false);
  
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth * 0.5,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geo.translate(0, 0, (-opts.depth * 0.5) / 2);
  geo.computeVertexNormals();
  return geo;
}

// Builds the button
export function buildButton(opts: ExtrudeOpts, radiusSvg: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radiusSvg * S, 0, Math.PI * 2, false);
  
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth * 1.2,
    bevelEnabled: opts.bevel > 0.001,
    bevelThickness: opts.bevel * 0.5,
    bevelSize: opts.bevel * 0.5,
    bevelSegments: 2,
    curveSegments: 32,
  });
  geo.translate(0, 0, -opts.depth * 0.6);
  geo.computeVertexNormals();
  return geo;
}

// Builds ring / tube for HUD rings
export function buildRing(radiusSvg: number, tubeRadius: number = 0.05): THREE.TubeGeometry {
  const curve = new THREE.EllipseCurve(0, 0, radiusSvg * S, radiusSvg * S, 0, Math.PI * 2, false, 0);
  const pts = curve.getPoints(64).map(p => new THREE.Vector3(p.x, p.y, 0));
  const path3 = new THREE.CatmullRomCurve3(pts, true);
  return new THREE.TubeGeometry(path3, 64, tubeRadius, 8, true);
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
