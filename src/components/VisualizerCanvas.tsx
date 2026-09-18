import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { audioEngine } from "../lib/audioEngine";
import { orbitAngleDeg, bobTransform, flipScaleX, throbScale, SVG_PX_TO_WORLD } from "../lib/animCurves";
import { buildArrowGeometry, buildRingGeometry, buildOutlineGeometry } from "../lib/svgMesh";

export type MaterialPreset = "obsidian" | "chrome" | "neon" | "hologram" | "paper" | "molten";
export type BackgroundMode = "void" | "paper" | "green" | "transparent" | "custom";

export interface MeshParams {
  depth: number;
  bevel: number;
  material: MaterialPreset;
  wireframe: boolean;
  edges: boolean;
  core: boolean;
  halo: boolean;
  particles: boolean;
  grid: boolean;
  extrusionPulse: number;
}

export interface GlitchParams {
  auto: boolean;
  sensitivity: number;
  cooldown: number;
  rgb: number;
  slice: number;
  vertex: number;
  grain: number;
  scanline: number;
  shakeOnBeat: number;
  invertPulse: boolean;
}

export interface SceneParams {
  background: BackgroundMode;
  customColor: string;
  autoOrbit: boolean;
  orbitSpeed: number;
  trippy: boolean;
  spokenWord: boolean;
  fov: number;
  vignette: number;
  speed: number;
}

export type GlitchType = "rgb" | "slice" | "skew" | "invert" | "pulse" | "random";

export interface VisualizerHandle {
  triggerGlitch: (t: GlitchType) => void;
  resetCamera: () => void;
  captureFrame: () => void;
}

interface Props {
  mesh: MeshParams;
  glitch: GlitchParams;
  scene: SceneParams;
  onFps?: (fps: number) => void;
  onBeat?: () => void;
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uRes;
uniform float uRgb;
uniform float uSlice;
uniform float uGrain;
uniform float uScan;
uniform float uVig;
uniform float uInvert;
uniform float uFlash;
uniform vec2 uShake;
uniform float uHue;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec3 shiftHue(vec3 c, float h) {
  if (abs(h) < 0.0001) return c;
  const vec3 k = vec3(0.57735, 0.57735, 0.57735);
  float cosA = cos(h);
  return c * cosA + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - cosA);
}

void main() {
  vec2 uv = vUv;
  // beat zoom punch
  uv = (uv - 0.5) * (1.0 + uFlash * 0.055) + 0.5;
  uv += uShake;
  // slice rows
  float row = floor(uv.y * 72.0);
  float r = hash(row * 1.37 + floor(uTime * 26.0) * 7.13);
  if (r < uSlice) {
    float mag = (hash(row * 3.1 + floor(uTime * 26.0)) - 0.5) * uSlice * 0.55;
    uv.x = fract(uv.x + mag);
  }
  // wobble line tear
  float tear = hash(floor(uTime * 9.0));
  if (tear > 0.965 - uSlice * 0.2) {
    float band = smoothstep(0.06, 0.0, abs(uv.y - fract(tear * 7.0) - 0.15));
    uv.x += band * (hash2(vec2(floor(uTime*30.0), 1.0)) - 0.5) * 0.3 * (0.4 + uSlice);
  }
  vec2 dir = uv - 0.5;
  float dist = length(dir * vec2(uRes.x / uRes.y, 1.0));
  // chromatic aberration — radial + horizontal
  vec2 ca = dir * uRgb * (0.55 + dist * 2.4);
  ca.x += uRgb * 0.028;
  vec3 cr = texture2D(tDiffuse, uv + ca).rgb;
  vec3 cg = texture2D(tDiffuse, uv).rgb;
  vec3 cb = texture2D(tDiffuse, uv - ca).rgb;
  vec3 col = vec3(cr.r, cg.g, cb.b);
  float alpha = texture2D(tDiffuse, uv).a;
  // scanlines
  col *= 1.0 - uScan * 0.28 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.4));
  // moving scan band
  float bandY = fract(uTime * 0.11);
  col += vec3(0.03, 0.05, 0.06) * smoothstep(0.09, 0.0, abs(uv.y - bandY)) * uScan * 1.6;
  // grain
  col += (hash2(uv * uRes + fract(uTime) * 913.0) - 0.5) * uGrain;
  // trippy hue drift
  col = shiftHue(col, uHue);
  // invert punch
  col = mix(col, vec3(1.0) - col, uInvert);
  // flash lift
  col += vec3(0.10, 0.11, 0.13) * uFlash;
  // vignette
  col *= 1.0 - uVig * smoothstep(0.35, 1.15, dist * 1.55);
  // linear -> sRGB (scene renders tonemapped-linear into the RT; the canvas expects sRGB)
  col = pow(max(col, vec3(0.0)), vec3(0.4545));
  gl_FragColor = vec4(col, alpha);
}
`;

function bgColorFor(mode: BackgroundMode, custom: string): THREE.Color | null {
  switch (mode) {
    case "void":
      return new THREE.Color("#06060c");
    case "paper":
      return new THREE.Color("#f4f4f4");
    case "green":
      return new THREE.Color("#00ff00");
    case "custom":
      return new THREE.Color(custom);
    case "transparent":
      return null;
  }
}

const VisualizerCanvas = forwardRef<VisualizerHandle, Props>(function VisualizerCanvas(
  { mesh, glitch, scene, onFps, onBeat },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paramsRef = useRef({ mesh, glitch, scene });
  paramsRef.current = { mesh, glitch, scene };
  const cbRef = useRef({ onFps, onBeat });
  cbRef.current = { onFps, onBeat };
  const apiRef = useRef<{ trigger: (t: GlitchType) => void; reset: () => void; capture: () => void }>({
    trigger: () => {},
    reset: () => {},
    capture: () => {},
  });

  useImperativeHandle(ref, () => ({
    triggerGlitch: (t) => apiRef.current.trigger(t),
    resetCamera: () => apiRef.current.reset(),
    captureFrame: () => apiRef.current.capture(),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* ---------- renderer / scene / camera ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene3 = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 120);
    const CAM_HOME = new THREE.Vector3(0, 2.7, 11.2);
    camera.position.copy(CAM_HOME);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene3.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = 1.62;
    controls.autoRotateSpeed = 5;

    /* ---------- lights ---------- */
    scene3.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 9, 7);
    scene3.add(key);
    const rimCyan = new THREE.PointLight(0x00f0ff, 90, 40, 2);
    rimCyan.position.set(-7, 3, -4);
    scene3.add(rimCyan);
    const rimMag = new THREE.PointLight(0xff2d78, 90, 40, 2);
    rimMag.position.set(7, -2, -5);
    scene3.add(rimMag);
    const front = new THREE.PointLight(0xffffff, 26, 30, 2);
    front.position.set(0, 1.5, 8);
    scene3.add(front);

    /* ---------- shared vertex-glitch uniforms ---------- */
    const vU = {
      uGlitch: { value: 0 },
      uTime: { value: 0 },
      uBass: { value: 0 },
    };
    function injectGlitch(mat: THREE.Material) {
      const m = mat as THREE.MeshStandardMaterial & { onBeforeCompile: unknown; customProgramCacheKey: unknown };
      m.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
        shader.uniforms.uGlitch = vU.uGlitch;
        shader.uniforms.uTime = vU.uTime;
        shader.uniforms.uBass = vU.uBass;
        shader.vertexShader =
          `uniform float uGlitch;\nuniform float uTime;\nuniform float uBass;\n` +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            {
              float h = fract(sin(dot(position.xy, vec2(12.9898, 78.233)) + uTime * 43.0) * 43758.5453);
              float gates = step(1.0 - (0.12 + uGlitch * 0.55), h);
              transformed.x += (h - 0.5) * uGlitch * 1.6 * gates;
              transformed.y += (fract(h * 7.31) - 0.5) * uGlitch * 0.9 * gates;
              transformed.z += sin(position.x * 22.0 + uTime * 34.0) * uGlitch * 0.35 * (0.3 + uBass);
              transformed.xy += vec2(sin(position.z * 30.0 + uTime * 21.0), cos(position.z * 26.0 - uTime * 17.0)) * uGlitch * 0.06;
            }`
          );
      };
      m.customProgramCacheKey = () => "orbital-glitch-v1";
    }

    /* ---------- materials ---------- */
    const arrowMat = new THREE.MeshPhysicalMaterial({ color: "#141419", metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.25 });
    const ringMat = new THREE.MeshPhysicalMaterial({ color: "#141419", metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.25 });
    const outlineMat = new THREE.MeshPhysicalMaterial({ color: "#1b1b22", metalness: 0.75, roughness: 0.32, clearcoat: 0.8 });
    const coreMat = new THREE.MeshStandardMaterial({ color: "#0b0b10", metalness: 0.4, roughness: 0.3, emissive: "#00f0ff", emissiveIntensity: 1.4, wireframe: true });
    const haloMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    [arrowMat, ringMat, outlineMat].forEach(injectGlitch);

    function applyMaterialPreset(p: MaterialPreset) {
      const mats = [arrowMat, ringMat, outlineMat];
      mats.forEach((m) => {
        m.transparent = false;
        m.opacity = 1;
        m.emissive = new THREE.Color("#000000");
        m.emissiveIntensity = 0;
        m.needsUpdate = false;
      });
      coreMat.wireframe = true;
      if (p === "obsidian") {
        mats.forEach((m) => {
          m.color.set("#131318");
          m.metalness = 0.88;
          m.roughness = 0.26;
        });
        outlineMat.color.set("#1e1e26");
        coreMat.emissive.set("#00f0ff");
      } else if (p === "chrome") {
        mats.forEach((m) => {
          m.color.set("#e9e9ef");
          m.metalness = 1.0;
          m.roughness = 0.1;
        });
        coreMat.emissive.set("#ff2d78");
      } else if (p === "neon") {
        arrowMat.color.set("#050507");
        arrowMat.emissive.set("#00f0ff");
        arrowMat.emissiveIntensity = 1.6;
        arrowMat.metalness = 0.2;
        arrowMat.roughness = 0.4;
        ringMat.color.set("#050507");
        ringMat.emissive.set("#ff2d78");
        ringMat.emissiveIntensity = 1.6;
        ringMat.metalness = 0.2;
        ringMat.roughness = 0.4;
        outlineMat.color.set("#050507");
        outlineMat.emissive.set("#b6ff2d");
        outlineMat.emissiveIntensity = 1.2;
        outlineMat.metalness = 0.2;
        outlineMat.roughness = 0.4;
        coreMat.emissive.set("#ffffff");
      } else if (p === "hologram") {
        mats.forEach((m) => {
          m.color.set("#00e5ff");
          m.emissive.set("#00b3ff");
          m.emissiveIntensity = 0.9;
          m.metalness = 0.1;
          m.roughness = 0.35;
          m.transparent = true;
          m.opacity = 0.72;
        });
        coreMat.emissive.set("#7df9ff");
        coreMat.wireframe = false;
      } else if (p === "paper") {
        mats.forEach((m) => {
          m.color.set("#111111");
          m.metalness = 0.0;
          m.roughness = 0.62;
        });
        coreMat.emissive.set("#111111");
      } else if (p === "molten") {
        mats.forEach((m) => {
          m.color.set("#200606");
          m.emissive.set("#ff4400");
          m.emissiveIntensity = 1.1;
          m.metalness = 0.55;
          m.roughness = 0.35;
        });
        outlineMat.emissive.set("#ffbb00");
        coreMat.emissive.set("#ff2200");
      }
    }
    applyMaterialPreset("obsidian");

    /* ---------- geometry / groups ---------- */
    const rootGroup = new THREE.Group();
    const glitchGroup = new THREE.Group();
    rootGroup.add(glitchGroup);
    scene3.add(rootGroup);

    let arrowGeo = buildArrowGeometry({ depth: 0.55, bevel: 0.045 });
    let ringGeo = buildRingGeometry({ depth: 0.55, bevel: 0.045 });
    const outlineGeo = buildOutlineGeometry(1);

    const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    glitchGroup.add(outlineMesh, ringMesh);

    const orbitGroup = new THREE.Group();
    glitchGroup.add(orbitGroup);

    interface ArrowRig {
      pivot: THREE.Group;
      bob: THREE.Group;
      flip: THREE.Group;
      mesh: THREE.Mesh;
      edge: THREE.LineSegments | null;
    }
    const rigs: ArrowRig[] = [];
    const edgeMat = new THREE.LineBasicMaterial({ color: "#67e8f9", transparent: true, opacity: 0.55 });
    const ringEdgeMat = new THREE.LineBasicMaterial({ color: "#f0abfc", transparent: true, opacity: 0.4 });

    function buildEdges(mesh: THREE.Mesh, geo: THREE.BufferGeometry, mat: THREE.LineBasicMaterial) {
      const old = mesh.children.find((c) => c instanceof THREE.LineSegments);
      if (old) {
        mesh.remove(old);
        (old as THREE.LineSegments).geometry.dispose();
      }
      try {
        const e = new THREE.EdgesGeometry(geo, 28);
        const lines = new THREE.LineSegments(e, mat);
        lines.visible = paramsRef.current.mesh.edges;
        mesh.add(lines);
        return lines;
      } catch {
        return null;
      }
    }

    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (-i * 120 * Math.PI) / 180;
      const bob = new THREE.Group();
      const flip = new THREE.Group();
      const meshObj = new THREE.Mesh(arrowGeo, arrowMat);
      const edge = buildEdges(meshObj, arrowGeo, edgeMat);
      flip.add(meshObj);
      bob.add(flip);
      pivot.add(bob);
      orbitGroup.add(pivot);
      rigs.push({ pivot, bob, flip, mesh: meshObj, edge });
    }
    buildEdges(ringMesh, ringGeo, ringEdgeMat);

    // inner core
    const coreGroup = new THREE.Group();
    const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), coreMat);
    const coreInner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    coreGroup.add(coreMesh, coreInner);
    glitchGroup.add(coreGroup);

    // outer gyro rings
    const gyro1 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.022, 10, 180), new THREE.MeshBasicMaterial({ color: "#00f0ff", transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const gyro2 = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.016, 10, 180), new THREE.MeshBasicMaterial({ color: "#ff2d78", transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    gyro1.rotation.x = Math.PI / 2.25;
    gyro2.rotation.x = Math.PI / 1.8;
    gyro2.rotation.y = 0.5;
    glitchGroup.add(gyro1, gyro2);

    // spectrum halo (instanced bars)
    const HALO_N = 108;
    const haloMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), haloMat, HALO_N);
    haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    const haloColor = new THREE.Color();
    scene3.add(haloMesh);

    // particles
    const P_COUNT = 1400;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(P_COUNT * 3);
    const pBase = new Float32Array(P_COUNT * 3);
    const pSpeed = new Float32Array(P_COUNT);
    for (let i = 0; i < P_COUNT; i++) {
      const r = 4.5 + Math.random() * 9;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(ph) * Math.cos(th);
      const y = r * Math.cos(ph) * 0.7;
      const z = r * Math.sin(ph) * Math.sin(th);
      pBase.set([x, y, z], i * 3);
      pPos.set([x, y, z], i * 3);
      pSpeed[i] = 0.15 + Math.random() * 0.9;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: "#8b9bff", size: 0.045, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const particles = new THREE.Points(pGeo, pMat);
    scene3.add(particles);

    // grid
    const grid = new THREE.GridHelper(44, 52, 0x2a2a3a, 0x17171f);
    grid.position.y = -3.4;
    (grid.material as THREE.Material).transparent = true;
    ((grid.material as unknown as { opacity: number }).opacity = 0.55);
    scene3.add(grid);

    /* ---------- post pipeline ---------- */
    const rt = new THREE.WebGLRenderTarget(container.clientWidth, container.clientHeight, { samples: 4, type: THREE.HalfFloatType });
    const postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postU = {
      tDiffuse: { value: rt.texture },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
      uRgb: { value: 0 },
      uSlice: { value: 0 },
      uGrain: { value: 0.07 },
      uScan: { value: 0.35 },
      uVig: { value: 0.55 },
      uInvert: { value: 0 },
      uFlash: { value: 0 },
      uShake: { value: new THREE.Vector2(0, 0) },
      uHue: { value: 0 },
    };
    const postMat = new THREE.ShaderMaterial({ uniforms: postU, vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false });
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

    /* ---------- glitch state ---------- */
    const G = { rgb: 0, slice: 0, skew: 0, invert: 0, flash: 0, lastGlitchTime: -999 };
    let nextAutoAt = 2.2;

    function trigger(type: GlitchType) {
      const pick = (arr: GlitchType[]) => arr[(Math.random() * arr.length) | 0];
      const t: GlitchType = type === "random" ? pick(["rgb", "slice", "skew", "invert", "pulse"]) : type;
      const power = 0.75 + Math.random() * 0.5;
      if (t === "rgb") G.rgb = Math.min(1.6, G.rgb + power);
      else if (t === "slice") G.slice = Math.min(1.6, G.slice + power);
      else if (t === "skew") G.skew = Math.min(1.6, G.skew + power);
      else if (t === "invert") G.invert = Math.min(1, G.invert + 0.9);
      else if (t === "pulse") {
        G.flash = Math.min(1.4, G.flash + 1);
        G.rgb = Math.min(1.6, G.rgb + 0.55);
        G.slice = Math.min(1.6, G.slice + 0.4);
      }
    }
    apiRef.current.trigger = trigger;
    apiRef.current.reset = () => {
      camera.position.copy(CAM_HOME);
      controls.target.set(0, 0.1, 0);
    };
    apiRef.current.capture = () => {
      renderer.domElement.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `orbital-glitch-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
    };

    /* ---------- geometry rebuild (depth/bevel) ---------- */
    let rebuildTimer: number | null = null;
    let lastDepth = paramsRef.current.mesh.depth;
    let lastBevel = paramsRef.current.mesh.bevel;
    let lastPreset: MaterialPreset = paramsRef.current.mesh.material;

    function rebuildExtrusion() {
      const { depth, bevel } = paramsRef.current.mesh;
      const nd = buildArrowGeometry({ depth, bevel });
      const nr = buildRingGeometry({ depth, bevel });
      const oa = arrowGeo;
      const orr = ringGeo;
      arrowGeo = nd;
      ringGeo = nr;
      rigs.forEach((r) => {
        r.mesh.geometry = nd;
        buildEdges(r.mesh, nd, edgeMat);
      });
      ringMesh.geometry = nr;
      buildEdges(ringMesh, nr, ringEdgeMat);
      oa.dispose();
      orr.dispose();
    }

    /* ---------- resize ---------- */
    function onResize() {
      const w = containerRef.current?.clientWidth ?? window.innerWidth;
      const h = containerRef.current?.clientHeight ?? window.innerHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      rt.setSize(w, h);
      postU.uRes.value.set(w, h);
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    /* ---------- loop ---------- */
    const clock = new THREE.Clock();
    let elapsed = 0;
    let orbitElapsed = 0;
    let fpsFrames = 0;
    let fpsTime = 0;
    let raf = 0;
    const camShake = new THREE.Vector2();

    const isRecordMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has('record');

    function tick(dtOverride?: number) {
      const rawDt = dtOverride !== undefined ? dtOverride : Math.min(clock.getDelta(), 0.05);
      const P = paramsRef.current;
      const dt = rawDt * 1; // real dt for audio
      elapsed += rawDt * P.scene.speed;
      const t = elapsed;

      // audio
      audioEngine.update(dt);
      const L = audioEngine.getLevels();
      if (L.beat) cbRef.current.onBeat?.();
      
      orbitElapsed += rawDt * P.scene.speed * (1 + L.energy * 0.5);

      // preset / toggles sync (cheap checks)
      if (P.mesh.material !== lastPreset) {
        lastPreset = P.mesh.material;
        applyMaterialPreset(lastPreset);
      }
      if (P.mesh.depth !== lastDepth || P.mesh.bevel !== lastBevel) {
        lastDepth = P.mesh.depth;
        lastBevel = P.mesh.bevel;
        if (isRecordMode) {
          rebuildExtrusion();
        } else {
          if (rebuildTimer) clearTimeout(rebuildTimer);
          rebuildTimer = window.setTimeout(rebuildExtrusion, 140);
        }
      }
      arrowMat.wireframe = ringMat.wireframe = outlineMat.wireframe = P.mesh.wireframe;
      coreGroup.visible = P.mesh.core;
      haloMesh.visible = P.mesh.halo;
      particles.visible = P.mesh.particles;
      const isKeyPlate = P.scene.background === "green";
      grid.visible = P.mesh.grid && !isKeyPlate;
      // edge visibility
      const wantEdges = P.mesh.edges && !P.mesh.wireframe;
      rigs.forEach((r) => r.mesh.children.forEach((c) => ((c as THREE.LineSegments).visible = wantEdges)));
      ringMesh.children.forEach((c) => ((c as THREE.LineSegments).visible = wantEdges));

      // background
      const bg = bgColorFor(P.scene.background, P.scene.customColor);
      if (bg) {
        scene3.background = bg;
        scene3.fog = new THREE.Fog(bg.clone(), 15, 34);
        renderer.setClearColor(bg, 1);
      } else {
        scene3.background = null;
        scene3.fog = null;
        renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
      }
      const isPaper = P.scene.background === "paper";
      // additive layers go invisible on near-white — use normal blending there
      haloMat.blending = isPaper ? THREE.NormalBlending : THREE.AdditiveBlending;
      pMat.blending = isPaper ? THREE.NormalBlending : THREE.AdditiveBlending;
      (gyro1.material as THREE.MeshBasicMaterial).blending = isPaper ? THREE.NormalBlending : THREE.AdditiveBlending;
      (gyro2.material as THREE.MeshBasicMaterial).blending = isPaper ? THREE.NormalBlending : THREE.AdditiveBlending;

      /* ----- orbital choreography (original timing + delays) ----- */
      const orbitT = orbitElapsed + 0.6; // delay-1: -0.6s
      const bobT = t - 0.04; // delay-3: 40ms
      const flipT = t - 1.2; // delay-2: 1.2s
      const orbitDeg = orbitAngleDeg(orbitT);
      orbitGroup.rotation.z = (-orbitDeg * Math.PI) / 180;

      const bob = bobTransform(bobT);
      const flipSX = flipScaleX(flipT);
      const lift = L.bass * 0.35 + L.beatPulse * 0.12;
      rigs.forEach((r) => {
        r.bob.position.y = -bob.y * SVG_PX_TO_WORLD + lift * 0.35;
        r.bob.scale.y = bob.sy;
        r.flip.scale.x = flipSX === 0 ? 0.0001 : flipSX;
      });

      const throb = throbScale(t);
      const outlineS = throb * (1 + L.bass * 0.075 + L.beatPulse * 0.028);
      outlineMesh.scale.set(outlineS, outlineS, 1);
      (outlineMesh.rotation as THREE.Euler).z = Math.sin(t * 0.24) * 0.02;

      const ringS = 1 + L.mid * 0.045 + L.beatPulse * 0.02;
      ringMesh.scale.set(ringS, ringS, 1);

      // extrusion breathing
      const ez = 1 + (L.bass * 0.9 + L.beatPulse * 0.5) * P.mesh.extrusionPulse;
      glitchGroup.scale.set(1, 1, ez);

      // core
      const coreS = 0.85 + L.bass * 0.75 + L.beatPulse * 0.35;
      coreGroup.scale.setScalar(coreS);
      coreGroup.rotation.y += rawDt * (0.6 + L.energy * 3.2);
      coreGroup.rotation.x += rawDt * (0.3 + L.treble * 2.2);
      (coreInner.material as THREE.MeshBasicMaterial).opacity = 0.55 + L.energy * 0.45;
      coreMat.emissiveIntensity = (P.mesh.material === "neon" ? 1.2 : 0.9) + L.energy * 1.6;

      // gyros
      gyro1.rotation.z += rawDt * (0.25 + L.mid * 1.6);
      gyro2.rotation.z -= rawDt * (0.18 + L.highMid * 1.4);
      const gyroPulse = 1 + L.energy * 0.08;
      gyro1.scale.setScalar(gyroPulse);
      gyro2.scale.setScalar(2 - gyroPulse > 1 ? 1 / gyroPulse : 1);
      (gyro1.material as THREE.MeshBasicMaterial).opacity = 0.32 + L.mid * 0.5;
      (gyro2.material as THREE.MeshBasicMaterial).opacity = 0.28 + L.highMid * 0.5;

      // trippy emissive cycling
      if (P.scene.trippy) {
        const hue = (t * 0.07 + L.energy * 0.25) % 1;
        arrowMat.emissive.setHSL(hue, 0.95, 0.42);
        ringMat.emissive.setHSL((hue + 0.33) % 1, 0.95, 0.42);
        outlineMat.emissive.setHSL((hue + 0.66) % 1, 0.95, 0.42);
        arrowMat.emissiveIntensity = ringMat.emissiveIntensity = outlineMat.emissiveIntensity = 0.55 + L.energy * 1.5;
        coreMat.emissive.setHSL((hue + 0.5) % 1, 1, 0.6);
        postU.uHue.value = Math.sin(t * 0.6) * 0.35 + L.energy * 0.5;
      } else {
        postU.uHue.value = 0;
        if (P.mesh.material !== "neon" && P.mesh.material !== "molten" && P.mesh.material !== "hologram") {
          const warm = L.energy * 0.35;
          arrowMat.emissive.setRGB(warm * 0.4, warm * 0.55, warm * 0.8);
          ringMat.emissive.setRGB(warm * 0.5, warm * 0.3, warm * 0.6);
          outlineMat.emissive.setRGB(warm * 0.3, warm * 0.4, warm * 0.4);
          arrowMat.emissiveIntensity = ringMat.emissiveIntensity = outlineMat.emissiveIntensity = 0.5 + L.energy;
        } else if (P.mesh.material === "neon" || P.mesh.material === "molten") {
          arrowMat.emissiveIntensity = 1.1 + L.energy * 1.8;
          ringMat.emissiveIntensity = 1.1 + L.energy * 1.8;
          outlineMat.emissiveIntensity = 0.9 + L.energy * 1.4;
        }
      }

      /* ----- spectrum halo ----- */
      if (haloMesh.visible) {
        const freq = audioEngine.freqData;
        const n = freq.length;
        for (let i = 0; i < HALO_N; i++) {
          const a = (i / HALO_N) * Math.PI * 2 + t * 0.12;
          // log-ish sampling of spectrum
          const fi = Math.floor(Math.pow(i / HALO_N, 1.6) * n * 0.72) + 2;
          const v = (freq[Math.min(n - 1, fi)] ?? 0) / 255;
          const h = 0.06 + v * 1.9 + L.beatPulse * 0.08;
          const R = 4.65;
          dummy.position.set(Math.cos(a) * R, Math.sin(a * 1.0) * 0.0 + (Math.sin(a * 3 + t) * 0.06), Math.sin(a) * R);
          dummy.position.y = Math.sin(a * 2.0 + t * 0.7) * 0.25;
          dummy.rotation.set(0, -a, 0);
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          haloMesh.setMatrixAt(i, dummy.matrix);
          if (P.scene.trippy) haloColor.setHSL((i / HALO_N + t * 0.05) % 1, 0.9, 0.6);
          else haloColor.setHSL(0.52 + v * 0.32 - L.energy * 0.08, 0.95, 0.55 + v * 0.2);
          haloMesh.setColorAt(i, haloColor);
        }
        haloMesh.instanceMatrix.needsUpdate = true;
        if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
      }

      /* ----- particles ----- */
      if (particles.visible) {
        const pos = pGeo.attributes.position as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const swirl = t * 0.05;
        const cs = Math.cos(swirl);
        const sn = Math.sin(swirl);
        for (let i = 0; i < P_COUNT; i++) {
          const j = i * 3;
          const bx = pBase[j];
          const by = pBase[j + 1];
          const bz = pBase[j + 2];
          const sp = pSpeed[i];
          const pulse = 1 + L.bass * 0.22 * sp + L.beatPulse * 0.1;
          // slow swirl around Y + bob
          const x = (bx * cs - bz * sn) * pulse;
          const z = (bx * sn + bz * cs) * pulse;
          const y = by * pulse + Math.sin(t * sp * 1.4 + i) * 0.18 * (0.4 + L.treble);
          arr[j] = x + Math.sin(t * 2.1 * sp + i * 1.7) * L.energy * 0.25;
          arr[j + 1] = y;
          arr[j + 2] = z;
        }
        pos.needsUpdate = true;
        pMat.size = 0.038 + L.treble * 0.05 + L.beatPulse * 0.02;
        pMat.opacity = 0.55 + L.energy * 0.4;
        if (P.scene.trippy) pMat.color.setHSL((t * 0.05) % 1, 0.7, 0.68);
        else pMat.color.set(isPaper ? "#5a5a72" : "#8b9bff");
      }

      // lights pulse
      rimCyan.intensity = 70 + L.bass * 130 + L.beatPulse * 60;
      rimMag.intensity = 70 + L.mid * 120 + L.beatPulse * 60;
      front.intensity = 22 + L.energy * 30;
      key.intensity = isPaper ? 2.2 : 1.5 + L.energy * 0.5;

      /* ----- glitch engine ----- */
      const isIdle = !audioEngine.liveInput && !audioEngine.offlineData;
      const swMod = P.scene.spokenWord ? 0.15 : 1.0; // Spoken word severely dampers random glitches
      
      // beat-triggered
      if (L.beat && P.glitch.auto && Math.random() < P.glitch.sensitivity * 0.85 * swMod) {
        if (t > G.lastGlitchTime + P.glitch.cooldown) {
          trigger("random");
          G.lastGlitchTime = t;
        }
      }
      
      // timed auto (like original GlitchController 0.5–3.5s)
      if (P.glitch.auto && t > nextAutoAt) {
        if ((!isIdle || Math.random() > 0.8) && t > G.lastGlitchTime + P.glitch.cooldown) {
          trigger(isIdle ? "rgb" : "random");
          G.lastGlitchTime = t;
        }
        const urgency = isIdle ? 0 : P.glitch.sensitivity * 0.65 * swMod + L.energy * 0.35 * swMod;
        nextAutoAt = t + (3.4 - urgency * 2.8) * (0.5 + Math.random()) + (isIdle ? 3 : 0);
      }
      // manual invert pulse on strong beats
      if (L.beat && P.glitch.invertPulse && L.bass > (P.scene.spokenWord ? 0.85 : 0.62)) {
        if (t > G.lastGlitchTime + P.glitch.cooldown) {
          G.invert = Math.min(1, G.invert + 0.55);
          G.lastGlitchTime = t;
        }
      }

      // decay
      G.rgb *= Math.exp(-rawDt * 3.6);
      G.slice *= Math.exp(-rawDt * 4.4);
      G.skew *= Math.exp(-rawDt * 5.2);
      G.invert *= Math.exp(-rawDt * 6.5);
      G.flash *= Math.exp(-rawDt * 4.0);

      const vGlitch = Math.min(1.5, Math.max(G.rgb, G.slice, G.skew) * 0.8 + L.beatPulse * 0.22 * P.glitch.vertex + L.energy * 0.12 * P.glitch.vertex);
      vU.uGlitch.value = vGlitch * P.glitch.vertex;
      vU.uTime.value = t;
      vU.uBass.value = L.bass;

      // transform jitter / skew on the whole rig
      const jAmt = (G.rgb * 0.35 + G.slice * 0.3) * (0.4 + P.glitch.sensitivity * 0.6);
      glitchGroup.position.x = (Math.random() - 0.5) * jAmt * 0.9;
      glitchGroup.position.y = (Math.random() - 0.5) * jAmt * 0.7;
      glitchGroup.rotation.z = G.skew * (Math.random() - 0.5) * 0.22;
      glitchGroup.rotation.x = G.skew * (Math.random() - 0.5) * 0.12;
      const sk = 1 + G.skew * 0.1;
      glitchGroup.scale.x = sk;
      glitchGroup.scale.y = 2 - sk > 1 ? 1 / sk : 1;
      if (G.skew < 0.01) {
        glitchGroup.rotation.z *= 0.8;
        glitchGroup.rotation.x *= 0.8;
        glitchGroup.scale.x += (1 - glitchGroup.scale.x) * 0.4;
        glitchGroup.scale.y += (1 - glitchGroup.scale.y) * 0.4;
      }

      // camera
      controls.autoRotate = P.scene.autoOrbit;
      controls.autoRotateSpeed = 5 * P.scene.orbitSpeed * (1 + L.energy * 0.9);
      controls.update();
      // camera shake - driven by continuous bass rumble & RMS loudness, not just beat impulse
      const bassDominance = Math.max(0, L.bass - (L.mid + L.treble) * 0.4);
      const rumble = L.bass * L.rms * bassDominance * 0.45;
      const shakeAmt = ((L.beatPulse * 0.15 + rumble) * P.glitch.shakeOnBeat + Math.max(G.rgb, G.slice) * 0.15) * swMod;
      
      camShake.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
      camera.position.x += camShake.x;
      camera.position.y += camShake.y;
      const targetFov = P.scene.fov + L.beatPulse * 3.2 + L.bass * 1.6;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * 0.35;
        camera.updateProjectionMatrix();
      }

      /* ----- post uniforms ----- */
      postU.uTime.value = t;
      postU.uRgb.value = Math.min(1.4, P.glitch.rgb * 0.16 + G.rgb * 0.55 + L.treble * 0.1 + L.beatPulse * 0.08);
      postU.uSlice.value = Math.min(1.2, P.glitch.slice * 0.12 + G.slice * 0.75);
      postU.uGrain.value = isKeyPlate ? 0 : P.glitch.grain * 0.16 + G.slice * 0.05;
      postU.uScan.value = isKeyPlate ? 0 : P.glitch.scanline;
      postU.uVig.value = isKeyPlate ? 0 : P.scene.vignette;
      postU.uInvert.value = Math.min(1, G.invert);
      postU.uFlash.value = Math.min(1.2, G.flash * 0.8 + L.beatPulse * 0.22);
      postU.uShake.value.set((Math.random() - 0.5) * shakeAmt * 0.2, (Math.random() - 0.5) * shakeAmt * 0.2);

      // render: scene → RT → post → screen
      renderer.setRenderTarget(rt);
      renderer.render(scene3, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);

      // fps
      fpsFrames++;
      fpsTime += rawDt;
      if (fpsTime >= 0.5) {
        cbRef.current.onFps?.(Math.round(fpsFrames / fpsTime));
        fpsFrames = 0;
        fpsTime = 0;
      }
    }

    function animate() {
      if (!isRecordMode) raf = requestAnimationFrame(animate);
      tick();
    }

    if (!isRecordMode) {
      animate();
    } else {
      (window as any).renderFrameOffline = (frameIndex: number) => {
        const fps = audioEngine.offlineFps;
        const dt = 1 / fps;
        audioEngine.seekOfflineFrame(frameIndex);
        tick(dt);
      };
    }

    /* ---------- cleanup ---------- */
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (rebuildTimer) clearTimeout(rebuildTimer);
      controls.dispose();
      rt.dispose();
      arrowGeo.dispose();
      ringGeo.dispose();
      outlineGeo.dispose();
      pGeo.dispose();
      [arrowMat, ringMat, outlineMat, coreMat, haloMat, pMat, edgeMat, ringEdgeMat, postMat].forEach((m) => m.dispose());
      pmrem.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" />
  );
});

export default VisualizerCanvas;
