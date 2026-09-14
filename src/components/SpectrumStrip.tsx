import { useEffect, useRef } from "react";
import { audioEngine } from "../lib/audioEngine";

interface Props {
  beatTick: number;
}

/** Bottom-docked live FFT readout: spectrum bars + waveform + band meters */
export default function SpectrumStrip({ beatTick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(128));
  const beatRef = useRef(0);
  beatRef.current = beatTick;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const raw = canvas.getContext("2d");
    if (!raw) return;
    const ctx: CanvasRenderingContext2D = raw;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas || !wrap) return;
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const BARS = 96;

    function draw() {
      raf = requestAnimationFrame(draw);
      if (w === 0 || h === 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const freq = audioEngine.freqData;
      const time = audioEngine.timeData;
      const L = audioEngine.getLevels();
      const n = Math.max(1, freq.length);

      // layout: left meters (150px) + spectrum + right wave (200px) — collapse on narrow
      const narrow = w < 720;
      const meterW = narrow ? 0 : 148;
      const waveW = narrow ? 0 : 190;
      const specX = meterW + 14;
      const specW = w - specX - waveW - 14;

      if (!narrow) {
        // ---- band meters ----
        const bands: Array<[string, number, string]> = [
          ["BASS", L.bass, "#00f0ff"],
          ["MID", L.mid, "#b6ff2d"],
          ["TREB", L.treble, "#ff2d78"],
        ];
        bands.forEach(([label, v, color], i) => {
          const y = 14 + i * 26;
          ctx.fillStyle = "rgba(255,255,255,0.42)";
          ctx.font = "600 9px 'JetBrains Mono', monospace";
          ctx.fillText(label, 14, y + 9);
          const bx = 58;
          const bw = meterW - 58 - 14;
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(bx, y, bw, 10);
          const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
          grad.addColorStop(0, color + "55");
          grad.addColorStop(1, color);
          ctx.fillStyle = grad;
          ctx.fillRect(bx, y, bw * Math.min(1, v), 10);
          // beat dot
          if (i === 0) {
            const pr = 3 + L.beatPulse * 5;
            ctx.beginPath();
            ctx.arc(bx + bw + 2, y + 5, 0, 0, 0);
            ctx.fillStyle = `rgba(255,45,120,${0.25 + L.beatPulse * 0.75})`;
            ctx.beginPath();
            ctx.arc(meterW - 8, y + 5, pr, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        // energy bar
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "600 9px 'JetBrains Mono', monospace";
        ctx.fillText("NRG", 14, 14 + 3 * 26 + 9);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(58, 14 + 3 * 26, meterW - 58 - 14, 6);
        const eg = ctx.createLinearGradient(58, 0, meterW - 14, 0);
        eg.addColorStop(0, "#00f0ff");
        eg.addColorStop(0.5, "#b6ff2d");
        eg.addColorStop(1, "#ff2d78");
        ctx.fillStyle = eg;
        ctx.fillRect(58, 14 + 3 * 26, (meterW - 58 - 14) * Math.min(1, L.energy), 6);
      }

      // ---- spectrum bars ----
      const peaks = peaksRef.current;
      const gap = 2;
      const bw = (specW - (BARS - 1) * gap) / BARS;
      const baseY = h - 12;
      const maxH = h - 26;
      for (let i = 0; i < BARS; i++) {
        const fi = Math.floor(Math.pow(i / BARS, 1.7) * n * 0.78) + 1;
        const v = (freq[Math.min(n - 1, fi)] ?? 0) / 255;
        const bh = Math.max(2, v * maxH);
        const x = specX + i * (bw + gap);
        const hue = 0.52 + (i / BARS) * 0.42 + L.energy * 0.06;
        ctx.fillStyle = `hsla(${hue * 360}, 95%, ${38 + v * 30}%, ${0.35 + v * 0.65})`;
        ctx.fillRect(x, baseY - bh, bw, bh);
        // peak cap
        if (v > peaks[i]) peaks[i] = v;
        else peaks[i] = Math.max(0, peaks[i] - 0.012);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(x, baseY - peaks[i] * maxH - 2, bw, 1.5);
      }
      // baseline
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(specX, baseY + 2, specW, 1);

      if (!narrow) {
        // ---- waveform ----
        const wx = w - waveW + 6;
        const ww = waveW - 20;
        const wy = h / 2;
        const wh = h / 2 - 14;
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.strokeRect(wx, 10, ww, h - 20);
        ctx.beginPath();
        const m = time.length;
        const step = Math.max(1, Math.floor(m / ww));
        for (let x = 0; x < ww; x++) {
          const v = (time[Math.floor((x / ww) * m)] ?? 128) / 255;
          const y = wy + (v - 0.5) * 2 * wh;
          if (x === 0) ctx.moveTo(wx + x, y);
          else ctx.lineTo(wx + x, y);
        }
        void step;
        const wg = ctx.createLinearGradient(wx, 0, wx + ww, 0);
        wg.addColorStop(0, "#00f0ff");
        wg.addColorStop(1, "#ff2d78");
        ctx.strokeStyle = wg;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "600 9px 'JetBrains Mono', monospace";
        ctx.fillText("WAVE", wx + 5, 21);
      }
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
