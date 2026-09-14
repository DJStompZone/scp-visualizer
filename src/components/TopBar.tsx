import { Camera, EyeOff, Maximize, SlidersHorizontal } from "lucide-react";
import type { AudioMode } from "../lib/audioEngine";
import { cn } from "../utils/cn";

interface Props {
  fps: number;
  beatTick: number;
  mode: AudioMode;
  fftSize: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onHideUI: () => void;
  onFullscreen: () => void;
  onCapture: () => void;
}

const MODE_STYLE: Record<AudioMode, string> = {
  idle: "border-white/15 bg-white/5 text-white/55",
  demo: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
  file: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  mic: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200",
};

export default function TopBar(p: Props) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
      {/* brand */}
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0b0b12]/80 py-2 pr-4 pl-2.5 backdrop-blur-xl">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-amber-300 shadow-[0_0_18px_rgba(34,211,238,0.35)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.2" opacity={0.85} />
            <path d="M12 5.4v5.4M9.6 8.2 12 10.8l2.4-2.6" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span>
          <span className="block text-[14px] leading-tight font-bold tracking-tight">
            ORBITAL<span className="text-cyan-300">//</span>GLITCH
          </span>
          <span className="block font-mono text-[9.5px] tracking-[0.24em] text-white/40">3D FFT VISUALIZER · MK-II</span>
        </span>
      </div>

      {/* status pills */}
      <div className="pointer-events-auto hidden items-center gap-1.5 rounded-2xl border border-white/10 bg-[#0b0b12]/80 p-1.5 backdrop-blur-xl md:flex">
        <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-white/60">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
          <span className="tabular-nums">{p.fps} FPS</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-white/60">
          <span key={p.beatTick} className="og-beatdot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia-400" />
          BEAT
        </span>
        <span className={cn("rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-widest uppercase", MODE_STYLE[p.mode])}>
          {p.mode}
        </span>
        <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-white/60 tabular-nums">
          FFT {p.fftSize}
        </span>
      </div>

      {/* actions */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#0b0b12]/80 p-1.5 backdrop-blur-xl">
        {[
          { icon: <Camera size={15} />, label: "PNG", fn: p.onCapture, title: "Capture frame (C)" },
          { icon: <Maximize size={15} />, label: "FULL", fn: p.onFullscreen, title: "Fullscreen (F)" },
          { icon: <EyeOff size={15} />, label: "HIDE", fn: p.onHideUI, title: "Hide UI for recording (H)" },
        ].map((b) => (
          <button
            key={b.label}
            onClick={b.fn}
            title={b.title}
            className="hidden flex-col items-center gap-0.5 rounded-lg border border-transparent px-2.5 py-1.5 font-mono text-[9px] tracking-widest text-white/55 transition-all hover:border-white/15 hover:bg-white/5 hover:text-white sm:flex"
          >
            {b.icon}
            {b.label}
          </button>
        ))}
        <button
          onClick={p.onTogglePanel}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 font-mono text-[9px] tracking-widest transition-all",
            p.panelOpen
              ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
              : "border-transparent text-white/55 hover:border-white/15 hover:bg-white/5 hover:text-white"
          )}
        >
          <SlidersHorizontal size={15} />
          DECK
        </button>
      </div>
    </header>
  );
}
