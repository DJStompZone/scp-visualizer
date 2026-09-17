import { useCallback, useEffect, useRef, useState } from "react";
import { Disc3, Eye, FolderOpen, MousePointer2, Sparkles } from "lucide-react";
import VisualizerCanvas, {
  type GlitchParams, type GlitchType, type MeshParams, type SceneParams, type VisualizerHandle,
} from "./components/VisualizerCanvas";
import ControlPanel, { type AudioSnapshot } from "./components/ControlPanel";
import SpectrumStrip from "./components/SpectrumStrip";
import TopBar from "./components/TopBar";
import { audioEngine } from "./lib/audioEngine";
import { cn } from "./utils/cn";

function snapshotAudio(): AudioSnapshot {
  return {
    mode: audioEngine.mode,
    fileName: audioEngine.fileName,
    filePlaying: audioEngine.filePlaying,
    fileDuration: audioEngine.fileDuration,
    volume: audioEngine.volume,
    fftSize: audioEngine.fftSize,
    smoothing: audioEngine.smoothing,
    beatThreshold: audioEngine.beatThreshold,
    bpm: audioEngine.bpm,
    demoPlaying: audioEngine.demoPlaying,
  };
}

export default function App() {
  const vizRef = useRef<VisualizerHandle>(null);

  const [mesh, setMeshState] = useState<MeshParams>({
    depth: 0.55, bevel: 0.045, material: "obsidian",
    wireframe: false, edges: true, core: true, halo: true,
    particles: true, grid: true, extrusionPulse: 0.55,
  });
  const [glitch, setGlitchState] = useState<GlitchParams>({
    auto: true, sensitivity: 0.55, rgb: 0.22, slice: 0.12, vertex: 0.85,
    grain: 0.35, scanline: 0.32, shakeOnBeat: 0.6, invertPulse: false,
  });
  const [scene, setSceneState] = useState<SceneParams>({
    background: "void", customColor: "#0d0221", autoOrbit: true,
    orbitSpeed: 1, trippy: false, fov: 38, vignette: 0.55, speed: 1,
  });
  const [audio, setAudio] = useState<AudioSnapshot>(snapshotAudio);
  const [fps, setFps] = useState(60);
  const [beatTick, setBeatTick] = useState(0);
  const isRecordMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has('record');
  const isCleanMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has('clean');
  const [uiHidden, setUiHidden] = useState(isRecordMode || isCleanMode);
  const [panelOpen, setPanelOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 1024 : true));
  const [welcome, setWelcome] = useState(!(isRecordMode || isCleanMode));
  const [dragOver, setDragOver] = useState(false);

  const setMesh = useCallback((p: Partial<MeshParams>) => setMeshState((s) => ({ ...s, ...p })), []);
  const setGlitch = useCallback((p: Partial<GlitchParams>) => setGlitchState((s) => ({ ...s, ...p })), []);
  const setScene = useCallback((p: Partial<SceneParams>) => setSceneState((s) => ({ ...s, ...p })), []);

  useEffect(() => audioEngine.subscribe(() => setAudio(snapshotAudio())), []);

  useEffect(() => {
    (window as any).initOfflineRender = async (file: File, config: any, targetFps: number) => {
      if (config?.mesh) setMesh(config.mesh);
      if (config?.glitch) setGlitch(config.glitch);
      if (config?.scene) setScene(config.scene);
      if (config?.audio) {
        if (config.audio.fftSize) audioEngine.setFFTSize(config.audio.fftSize);
        if (config.audio.smoothing !== undefined) audioEngine.setSmoothing(config.audio.smoothing);
        if (config.audio.beatThreshold !== undefined) audioEngine.setBeatThreshold(config.audio.beatThreshold);
      }
      
      const duration = await audioEngine.loadOffline(file, targetFps);
      return Math.ceil(duration * targetFps);
    };
  }, [setMesh, setGlitch, setScene]);

  const trigger = useCallback((t: GlitchType) => vizRef.current?.triggerGlitch(t), []);
  const resetCamera = useCallback(() => vizRef.current?.resetCamera(), []);
  const capture = useCallback(() => vizRef.current?.captureFrame(), []);
  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch {
      /* noop */
    }
  }, []);

  /* keyboard shortcuts */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "h") setUiHidden((v) => !v);
      else if (k === "f") toggleFullscreen();
      else if (k === "g") trigger("random");
      else if (k === "c") capture();
      else if (k === "1") trigger("rgb");
      else if (k === "2") trigger("slice");
      else if (k === "3") trigger("skew");
      else if (k === "4") trigger("invert");
      else if (k === "5") trigger("pulse");
      else if (k === " ") {
        e.preventDefault();
        if (audioEngine.mode === "demo") audioEngine.toggleDemo();
        else if (audioEngine.mode === "file") audioEngine.toggleFilePlay();
        else audioEngine.setMode("demo");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trigger, capture, toggleFullscreen]);

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#06060c] font-sans text-white select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) {
          audioEngine.loadFile(f);
          setWelcome(false);
        }
      }}
    >
      {scene.background === "transparent" && <div className="og-checker-lg absolute inset-0" />}

      {/* 3D stage */}
      <VisualizerCanvas
        ref={vizRef}
        mesh={mesh}
        glitch={glitch}
        scene={scene}
        onFps={setFps}
        onBeat={() => setBeatTick((t) => t + 1)}
      />

      {/* drag overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-cyan-500/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-cyan-300/70 bg-black/60 px-10 py-8 text-center">
            <FolderOpen size={30} className="mx-auto mb-2 text-cyan-300" />
            <div className="text-lg font-bold">DROP TO LOAD TRACK</div>
            <div className="font-mono text-xs text-white/50">mp3 · wav · ogg · m4a</div>
          </div>
        </div>
      )}

      {!uiHidden && (
        <TopBar
          fps={fps}
          beatTick={beatTick}
          mode={audio.mode}
          fftSize={audio.fftSize}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((v) => !v)}
          onHideUI={() => setUiHidden(true)}
          onFullscreen={toggleFullscreen}
          onCapture={capture}
        />
      )}

      {/* control deck */}
      {!uiHidden && panelOpen && (
        <div className="absolute top-[74px] right-3 bottom-[128px] z-20 hidden w-[318px] sm:block">
          <ControlPanel
            mesh={mesh} setMesh={setMesh}
            glitch={glitch} setGlitch={setGlitch}
            scene={scene} setScene={setScene}
            audio={audio}
            onTrigger={trigger}
            onResetCamera={resetCamera}
            onCapture={capture}
            onHideUI={() => setUiHidden(true)}
            onFullscreen={toggleFullscreen}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}
      {/* mobile deck */}
      {!uiHidden && panelOpen && (
        <div className="absolute inset-x-3 bottom-[128px] z-20 h-[46vh] sm:hidden">
          <ControlPanel
            mesh={mesh} setMesh={setMesh}
            glitch={glitch} setGlitch={setGlitch}
            scene={scene} setScene={setScene}
            audio={audio}
            onTrigger={trigger}
            onResetCamera={resetCamera}
            onCapture={capture}
            onHideUI={() => setUiHidden(true)}
            onFullscreen={toggleFullscreen}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}

      {/* bottom FFT strip */}
      {!uiHidden && (
        <div
          className={cn(
            "absolute bottom-3 left-3 z-20 h-[108px] rounded-2xl border border-white/10 bg-[#0b0b12]/80 backdrop-blur-xl transition-all",
            panelOpen ? "right-3 sm:right-[342px]" : "right-3"
          )}
        >
          <div className="flex h-full items-stretch gap-1 p-2">
            <div className="hidden w-[118px] shrink-0 flex-col justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 lg:flex">
              <div className="font-mono text-[9px] tracking-[0.2em] text-white/40">LIVE FFT</div>
              <div className="font-mono text-[10px] leading-relaxed text-white/55">
                <span className="text-cyan-300">◉</span> {audio.mode.toUpperCase()}
                <br />
                {audio.mode === "file" && audio.fileName ? (
                  <span className="block max-w-[100px] truncate text-white/80">{audio.fileName}</span>
                ) : audio.mode === "demo" ? (
                  <span className="text-white/80 tabular-nums">{audio.bpm} BPM GEN</span>
                ) : (
                  <span className="text-white/40">SIM GROOVE</span>
                )}
              </div>
              <div className="font-mono text-[9px] text-white/30">H hide · F full · SPACE play</div>
            </div>
            <div className="min-w-0 flex-1">
              <SpectrumStrip beatTick={beatTick} />
            </div>
          </div>
        </div>
      )}

      {/* hidden-UI restore */}
      {uiHidden && !isRecordMode && !isCleanMode && (
        <button
          onClick={() => setUiHidden(false)}
          className="absolute right-4 bottom-4 z-30 flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 font-mono text-[11px] tracking-widest text-white/60 opacity-30 backdrop-blur transition-all hover:opacity-100"
        >
          <Eye size={13} /> SHOW UI (H)
        </button>
      )}

      {/* welcome */}
      {welcome && !uiHidden && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/45 p-4 backdrop-blur-[3px]" onClick={() => setWelcome(false)}>
          <div
            className="og-rise w-full max-w-[520px] overflow-hidden rounded-3xl border border-white/12 bg-[#0c0c14]/95 shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative bg-gradient-to-r from-cyan-500/25 via-fuchsia-500/25 to-amber-400/20 p-6 pb-5">
              <div className="font-mono text-[10px] tracking-[0.3em] text-cyan-300">SVG → EXTRUDED MESH → FFT</div>
              <h1 className="mt-1 text-[30px] leading-none font-bold tracking-tight">
                ORBITAL<span className="text-cyan-300">//</span>GLITCH
              </h1>
              <p className="mt-2 max-w-[440px] text-[13px] leading-relaxed text-white/65">
                SCP music visualizer, <span className="text-white">driven live by FFT</span> with shader-grade glitch. Built for screen-capture.
              </p>
            </div>
            <div className="space-y-2.5 p-6 pt-5">
              <button
                onClick={() => {
                  audioEngine.setMode("demo");
                  setWelcome(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-3.5 text-left transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <Disc3 size={20} className="shrink-0 animate-[spin_4s_linear_infinite]" />
                <span>
                  <span className="block text-[14px] font-bold">Play the built-in generative set</span>
                  <span className="block text-[12px] text-white/75">Instant FFT signal — no files needed. Recommended first.</span>
                </span>
              </button>
              <button
                onClick={() => {
                  audioEngine.setMode("file");
                  setWelcome(false);
                  setPanelOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:border-emerald-400/40 hover:bg-emerald-400/5"
              >
                <FolderOpen size={20} className="shrink-0 text-emerald-300" />
                <span>
                  <span className="block text-[14px] font-bold">Load your own track</span>
                  <span className="block text-[12px] text-white/55">Or just drag &amp; drop audio anywhere. Loops for long takes.</span>
                </span>
              </button>
              <button
                onClick={() => setWelcome(false)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3.5 text-left transition-colors hover:border-white/30"
              >
                <MousePointer2 size={20} className="shrink-0 text-white/50" />
                <span>
                  <span className="block text-[14px] font-bold">Just explore the rig</span>
                  <span className="block text-[12px] text-white/55">Idle groove is already running. Drag to orbit · scroll to zoom.</span>
                </span>
              </button>
              <div className="flex items-center justify-between pt-1 font-mono text-[10px] text-white/35">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={11} /> press H to hide UI for clean capture
                </span>
                <span>1–5 trigger glitch · G random</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
