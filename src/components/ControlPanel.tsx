import { useEffect, useRef, useState } from "react";
import {
  Activity, Aperture, Box, Camera, Clapperboard, EyeOff, Maximize, Mic, Pause, Play,
  RotateCcw, Sparkles, Upload, Volume2, Waves, X, Zap,
} from "lucide-react";
import type { MeshParams, GlitchParams, SceneParams, GlitchType, MaterialPreset, BackgroundMode } from "./VisualizerCanvas";
import { audioEngine, type AudioMode } from "../lib/audioEngine";
import { cn } from "../utils/cn";

export interface AudioSnapshot {
  mode: AudioMode;
  fileName: string;
  filePlaying: boolean;
  fileDuration: number;
  volume: number;
  fftSize: number;
  smoothing: number;
  beatThreshold: number;
  bpm: number;
  demoPlaying: boolean;
}

interface Props {
  mesh: MeshParams;
  setMesh: (p: Partial<MeshParams>) => void;
  glitch: GlitchParams;
  setGlitch: (p: Partial<GlitchParams>) => void;
  scene: SceneParams;
  setScene: (p: Partial<SceneParams>) => void;
  audio: AudioSnapshot;
  onTrigger: (t: GlitchType) => void;
  onResetCamera: () => void;
  onCapture: () => void;
  onHideUI: () => void;
  onFullscreen: () => void;
  onClose: () => void;
}

/* ---------- tiny building blocks ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-white/10" />
        <span className="font-mono text-[10px] font-semibold tracking-[0.22em] text-white/45 uppercase">{title}</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>
      {children}
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-white/60">{props.label}</span>
        <span className="font-mono text-[11px] font-semibold text-cyan-300 tabular-nums">
          {props.format ? props.format(props.value) : props.value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="og-slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; accent?: string }) {
  return (
    <button
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "flex w-full items-center justify-between rounded-lg border px-2.5 py-2 font-mono text-[11px] transition-all",
        props.checked
          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
          : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/75"
      )}
    >
      <span>{props.label}</span>
      <span className={cn("relative h-4 w-7 rounded-full transition-colors", props.checked ? (props.accent ?? "bg-cyan-400") : "bg-white/15")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", props.checked ? "left-3.5" : "left-0.5")} />
      </span>
    </button>
  );
}

function Seg<T extends string>(props: { options: Array<{ v: T; label: string }>; value: T; onChange: (v: T) => void; cols?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${props.cols ?? props.options.length}, 1fr)` }}>
      {props.options.map((o) => (
        <button
          key={o.v}
          onClick={() => props.onChange(o.v)}
          className={cn(
            "rounded-lg border px-1 py-1.5 font-mono text-[10.5px] transition-all",
            props.value === o.v
              ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.25)]"
              : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white/80"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------- panel ---------- */

type Tab = "audio" | "mesh" | "glitch" | "scene";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "audio", label: "AUDIO", icon: <Activity size={13} /> },
  { id: "mesh", label: "MESH", icon: <Box size={13} /> },
  { id: "glitch", label: "GLITCH", icon: <Zap size={13} /> },
  { id: "scene", label: "SCENE", icon: <Clapperboard size={13} /> },
];

const MATERIAL_SWATCH: Record<MaterialPreset, string> = {
  obsidian: "#2a2a33",
  chrome: "#e9e9ef",
  neon: "#00f0ff",
  hologram: "#7dd3fc",
  paper: "#f4f4f4",
  molten: "#ff4400",
};

const BG_SWATCH: Record<Exclude<BackgroundMode, "custom">, string> = {
  void: "#06060c",
  paper: "#f4f4f4",
  green: "#00ff00",
  transparent: "checker",
};

export default function ControlPanel(props: Props) {
  const { mesh, glitch, scene, audio } = props;
  const [tab, setTab] = useState<Tab>("audio");
  const fileRef = useRef<HTMLInputElement>(null);
  const [seekPos, setSeekPos] = useState(0);

  useEffect(() => {
    if (audio.mode !== "file") return;
    const id = window.setInterval(() => {
      setSeekPos(audioEngine.audioEl?.currentTime ?? 0);
    }, 250);
    return () => clearInterval(id);
  }, [audio.mode]);

  return (
    <div className="flex h-full w-[318px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b12]/85 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-1 py-2 font-mono text-[10px] font-semibold tracking-widest transition-all",
              tab === t.id ? "bg-cyan-400/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]" : "text-white/40 hover:bg-white/5 hover:text-white/75"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <button onClick={props.onClose} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white lg:hidden">
          <X size={14} />
        </button>
      </div>

      {/* body */}
      <div className="og-scroll flex-1 space-y-5 overflow-y-auto p-4">
        {tab === "audio" && (
          <>
            <Section title="Source">
              <Seg<AudioMode>
                cols={4}
                value={audio.mode}
                onChange={(m) => audioEngine.setMode(m)}
                options={[
                  { v: "idle", label: "IDLE" },
                  { v: "demo", label: "DEMO" },
                  { v: "file", label: "FILE" },
                  { v: "mic", label: "MIC" },
                ]}
              />

              {audio.mode === "demo" && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <button
                    onClick={() => audioEngine.toggleDemo()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-3 py-2.5 text-[13px] font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.99]"
                  >
                    {audio.demoPlaying ? <Pause size={15} /> : <Play size={15} />}
                    {audio.demoPlaying ? "STOP GENERATIVE SET" : "PLAY GENERATIVE SET"}
                  </button>
                  <Slider label="Tempo" value={audio.bpm} min={90} max={150} step={1} onChange={(v) => audioEngine.setBpm(v)} format={(v) => `${v.toFixed(0)} BPM`} />
                  <p className="font-mono text-[10px] leading-relaxed text-white/35">
                    Built-in 128 BPM techno sketch — kick / snare / hats / rolling bass / arp. Real FFT, no files needed.
                  </p>
                </div>
              )}

              {audio.mode === "file" && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) audioEngine.loadFile(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-400/40 bg-cyan-400/5 px-3 py-2.5 text-[12.5px] font-medium text-cyan-200 transition-colors hover:bg-cyan-400/10"
                  >
                    <Upload size={15} />
                    {audio.fileName || "DROP AUDIO FILE / BROWSE"}
                  </button>
                  {audio.fileName !== "" && (
                    <>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => audioEngine.toggleFilePlay()}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
                        >
                          {audio.filePlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px] text-white/80">{audio.fileName}</div>
                          <div className="font-mono text-[10px] text-white/40 tabular-nums">
                            {fmtTime(seekPos)} / {fmtTime(audio.fileDuration)}
                          </div>
                        </div>
                      </div>
                      <input
                        type="range"
                        className="og-slider"
                        min={0}
                        max={Math.max(1, audio.fileDuration)}
                        step={0.1}
                        value={Math.min(seekPos, audio.fileDuration || 0)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSeekPos(v);
                          audioEngine.seekFile(v);
                        }}
                      />
                      <p className="font-mono text-[10px] text-white/35">Loops automatically — perfect for long renders.</p>
                    </>
                  )}
                </div>
              )}

              {audio.mode === "mic" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/5 p-3">
                  <Mic size={15} className="mt-0.5 shrink-0 text-fuchsia-300" />
                  <p className="font-mono text-[10.5px] leading-relaxed text-white/55">
                    Live microphone input driving the FFT. No monitoring (no feedback). Chrome may need a page reload after granting permission.
                  </p>
                </div>
              )}

              {audio.mode === "idle" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <Waves size={15} className="mt-0.5 shrink-0 text-white/40" />
                  <p className="font-mono text-[10.5px] leading-relaxed text-white/55">
                    Simulated groove so the rig stays alive with no input. Pick DEMO for real synthesized FFT, FILE for your track, MIC for live.
                  </p>
                </div>
              )}
            </Section>

            <Section title="Analyzer">
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] text-white/60">FFT size</div>
                <Seg
                  cols={5}
                  value={String(audio.fftSize)}
                  onChange={(v) => audioEngine.setFFTSize(parseInt(v))}
                  options={[
                    { v: "512", label: "512" },
                    { v: "1024", label: "1k" },
                    { v: "2048", label: "2k" },
                    { v: "4096", label: "4k" },
                    { v: "8192", label: "8k" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2">
                <Volume2 size={13} className="shrink-0 text-white/40" />
                <div className="flex-1">
                  <Slider label="Monitor volume" value={audio.volume} min={0} max={1} step={0.01} onChange={(v) => audioEngine.setVolume(v)} format={(v) => `${Math.round(v * 100)}%`} />
                </div>
              </div>
              <Slider label="FFT smoothing" value={audio.smoothing} min={0.5} max={0.95} step={0.01} onChange={(v) => audioEngine.setSmoothing(v)} />
              <Slider label="Beat threshold" value={audio.beatThreshold} min={0.1} max={0.7} step={0.01} onChange={(v) => audioEngine.setBeatThreshold(v)} />
            </Section>
          </>
        )}

        {tab === "mesh" && (
          <>
            <Section title="Material">
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(MATERIAL_SWATCH) as MaterialPreset[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => props.setMesh({ material: m })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-all",
                      mesh.material === m
                        ? "border-cyan-400/50 bg-cyan-400/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    )}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-white/25 shadow-inner"
                      style={{ background: m === "paper" ? "#f4f4f4" : m === "neon" ? "linear-gradient(135deg,#00f0ff,#ff2d78)" : MATERIAL_SWATCH[m] }}
                    />
                    <span className={cn("font-mono text-[9.5px] tracking-wider uppercase", mesh.material === m ? "text-cyan-100" : "text-white/50")}>{m}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Extrusion">
              <Slider label="Depth" value={mesh.depth} min={0.08} max={1.6} step={0.01} onChange={(v) => props.setMesh({ depth: v })} format={(v) => `${v.toFixed(2)}u`} />
              <Slider label="Bevel" value={mesh.bevel} min={0} max={0.12} step={0.005} onChange={(v) => props.setMesh({ bevel: v })} format={(v) => v.toFixed(3)} />
              <Slider label="Bass pump (Z)" value={mesh.extrusionPulse} min={0} max={1.5} step={0.01} onChange={(v) => props.setMesh({ extrusionPulse: v })} />
            </Section>

            <Section title="Layers">
              <div className="grid grid-cols-2 gap-1.5">
                <Toggle label="Wireframe" checked={mesh.wireframe} onChange={(v) => props.setMesh({ wireframe: v })} />
                <Toggle label="Edge lines" checked={mesh.edges} onChange={(v) => props.setMesh({ edges: v })} />
                <Toggle label="Core" checked={mesh.core} onChange={(v) => props.setMesh({ core: v })} />
                <Toggle label="FFT halo" checked={mesh.halo} onChange={(v) => props.setMesh({ halo: v })} />
                <Toggle label="Particles" checked={mesh.particles} onChange={(v) => props.setMesh({ particles: v })} />
                <Toggle label="Grid floor" checked={mesh.grid} onChange={(v) => props.setMesh({ grid: v })} />
              </div>
            </Section>
          </>
        )}

        {tab === "glitch" && (
          <>
            <Section title="Manual triggers">
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["rgb", "RGB SPLIT"],
                    ["slice", "SLICE"],
                    ["skew", "SKEW"],
                    ["invert", "INVERT"],
                    ["pulse", "PULSE"],
                    ["random", "RANDOM"],
                  ] as Array<[GlitchType, string]>
                ).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => props.onTrigger(t)}
                    className={cn(
                      "rounded-lg border px-1 py-2.5 font-mono text-[10px] font-semibold tracking-wider transition-all active:scale-95",
                      t === "random"
                        ? "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200 hover:bg-fuchsia-400/20"
                        : "border-white/12 bg-white/[0.04] text-white/70 hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Auto glitch">
              <Toggle label="Beat + timer auto-glitch" checked={glitch.auto} onChange={(v) => props.setGlitch({ auto: v })} />
              <Slider label="Sensitivity" value={glitch.sensitivity} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ sensitivity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Toggle label="Invert flash on hard kicks" checked={glitch.invertPulse} onChange={(v) => props.setGlitch({ invertPulse: v })} />
            </Section>

            <Section title="Post chain">
              <Slider label="RGB split base" value={glitch.rgb} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ rgb: v })} />
              <Slider label="Slice base" value={glitch.slice} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ slice: v })} />
              <Slider label="Vertex warp" value={glitch.vertex} min={0} max={1.5} step={0.01} onChange={(v) => props.setGlitch({ vertex: v })} />
              <Slider label="Film grain" value={glitch.grain} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ grain: v })} />
              <Slider label="Scanlines" value={glitch.scanline} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ scanline: v })} />
              <Slider label="Camera shake on beat" value={glitch.shakeOnBeat} min={0} max={1} step={0.01} onChange={(v) => props.setGlitch({ shakeOnBeat: v })} />
            </Section>
          </>
        )}

        {tab === "scene" && (
          <>
            <Section title="Backdrop">
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.keys(BG_SWATCH) as Array<Exclude<BackgroundMode, "custom">>).map((b) => (
                  <button
                    key={b}
                    onClick={() => props.setScene({ background: b })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition-all",
                      scene.background === b ? "border-cyan-400/50 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    )}
                  >
                    <span
                      className={cn("h-5 w-full rounded border border-white/20", BG_SWATCH[b] === "checker" && "og-checker")}
                      style={BG_SWATCH[b] === "checker" ? undefined : { background: BG_SWATCH[b] }}
                    />
                    <span className={cn("font-mono text-[9px] tracking-wider uppercase", scene.background === b ? "text-cyan-100" : "text-white/50")}>
                      {b === "transparent" ? "ALPHA" : b}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <button
                  onClick={() => props.setScene({ background: "custom" })}
                  className={cn("font-mono text-[11px]", scene.background === "custom" ? "text-cyan-200" : "text-white/55")}
                >
                  CUSTOM
                </button>
                <input
                  type="color"
                  value={scene.customColor}
                  onChange={(e) => props.setScene({ customColor: e.target.value, background: "custom" })}
                  className="h-7 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
                />
                <span className="font-mono text-[10px] text-white/35 uppercase">{scene.customColor}</span>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-white/35">
                ALPHA gives true transparency for compositing. GREEN is a chroma key plate. PAPER matches your original SVG page.
              </p>
            </Section>

            <Section title="Camera + motion">
              <Toggle label="Auto orbit (12s loop)" checked={scene.autoOrbit} onChange={(v) => props.setScene({ autoOrbit: v })} />
              <Slider label="Orbit speed" value={scene.orbitSpeed} min={0} max={2.5} step={0.01} onChange={(v) => props.setScene({ orbitSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
              <Slider label="Choreography speed" value={scene.speed} min={0.1} max={2} step={0.01} onChange={(v) => props.setScene({ speed: v })} format={(v) => `${v.toFixed(2)}×`} />
              <Slider label="FOV" value={scene.fov} min={24} max={62} step={0.5} onChange={(v) => props.setScene({ fov: v })} format={(v) => `${v.toFixed(1)}°`} />
              <Slider label="Vignette" value={scene.vignette} min={0} max={1} step={0.01} onChange={(v) => props.setScene({ vignette: v })} />
            </Section>

            <Section title="Trip mode">
              <button
                onClick={() => props.setScene({ trippy: !scene.trippy })}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[13px] font-semibold transition-all active:scale-[0.99]",
                  scene.trippy
                    ? "border-transparent bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-400 text-white shadow-[0_0_24px_rgba(217,70,239,0.4)]"
                    : "border-white/12 bg-white/[0.04] text-white/65 hover:border-fuchsia-400/40 hover:text-fuchsia-200"
                )}
              >
                <Sparkles size={15} />
                {scene.trippy ? "TRIP MODE: ON" : "ENGAGE TRIP MODE"}
              </button>
              <p className="font-mono text-[10px] leading-relaxed text-white/35">
                Hue-cycling emissives, rainbow halo + particles, drifting color grade. Driven by the same FFT.
              </p>
            </Section>
          </>
        )}
      </div>

      {/* footer actions */}
      <div className="grid grid-cols-4 gap-1.5 border-t border-white/10 p-2.5">
        {[
          { icon: <RotateCcw size={14} />, label: "CAM", fn: props.onResetCamera },
          { icon: <Camera size={14} />, label: "PNG", fn: props.onCapture },
          { icon: <Maximize size={14} />, label: "FULL", fn: props.onFullscreen },
          { icon: <EyeOff size={14} />, label: "HIDE", fn: props.onHideUI },
        ].map((b) => (
          <button
            key={b.label}
            onClick={b.fn}
            className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] py-2 font-mono text-[9px] tracking-widest text-white/55 transition-all hover:border-white/25 hover:text-white"
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>

      {/* original-motion credit */}
      <div className="flex items-center justify-center gap-1.5 border-t border-white/5 py-1.5 font-mono text-[9px] tracking-widest text-white/25">
        <Aperture size={10} />
        ORBIT 9s · BOB 9s · FLIP 6s · THROB 12s
      </div>
    </div>
  );
}
