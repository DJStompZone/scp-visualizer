# ORBITAL//GLITCH

ORBITAL//GLITCH is a highly customizable, shader-driven 3D audio visualizer built with React, Three.js, and Tailwind CSS. It is designed to be driven live by Fast Fourier Transform (FFT) audio data, featuring real-time generative glitch effects, dynamic meshes, and a built-in techno sequence generator.

It's built with screen-capture and content creation in mind, offering both a live interactive web interface and a powerful CLI tool to programmatically render perfectly-synced 4K videos frame-by-frame.

## Features

- **Real-time 3D Audio Reactivity:** Visuals react to bass, mids, treble, and beats using live FFT.
- **Shader-Grade Glitch Effects:** Features chromatic aberration (RGB shift), scanlines, slicing, vertex displacement, and CRT grain.
- **Multiple Audio Sources:** Play the built-in generative techno set, use your microphone, or drag-and-drop any `.mp3`, `.wav`, `.ogg`, or `.m4a` file.
- **High-Fidelity Video Rendering:** A built-in CLI wrapper allows you to render offline, deterministic videos at 60FPS up to 4K resolution with zero audio desynchronization.
- **Customizable Themes:** Switch between pre-built material presets like *Obsidian, Chrome, Neon, Hologram, Paper,* and *Molten*.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [FFmpeg](https://ffmpeg.org/download.html) (Required only if you want to use the CLI video renderer)

### Installation

Clone the repository and install the dependencies:

```bash
npm install
```

### Running the Web Interface

To start the local development server:

```bash
npm run dev
```
Open `http://localhost:5173` in your browser. 

**Web Controls:**
- `Drag & Drop`: Load your own audio track.
- `Space`: Toggle play/pause.
- `H`: Hide/Show the UI for clean screen capture.
- `F`: Toggle fullscreen.
- `1-5`: Trigger manual glitch effects (RGB, Slice, Skew, Invert, Pulse).
- `G`: Trigger a random glitch effect.
- `C`: Capture a quick PNG screenshot of the current frame.

You can also use the `?clean=1` URL parameter (e.g. `http://localhost:5173/?clean=1`) to load the application with all UI completely disabled by default for pristine manual recording.

---

## Programmatic Video Rendering (CLI)

The project includes a Node.js CLI script that utilizes Puppeteer and FFmpeg to render perfectly synchronized, stutter-free videos of the visualizer. Unlike screen-recording, the CLI pre-computes the audio FFT data and renders the video deterministically frame-by-frame, ensuring perfect 60fps output even at 4K resolution.

### Usage

```bash
npm run render -- --input <path-to-audio> [options]
```

### CLI Options

| Option | Shortcut | Default | Description |
| :--- | :--- | :--- | :--- |
| `--input` | `-i` | **Required** | Path to the input audio file (mp3, wav, etc.) |
| `--output` | `-o` | `output.mp4` | Path for the generated video file. |
| `--resolution` | `-r` | `1080p` | Output resolution. Allowed values: `1080p`, `1440p`, `4k`. |
| `--fps` | `-f` | `60` | Frames per second for the output video. |
| `--config` | `-c` | *(None)* | Path to a JSON configuration file to set visualizer parameters. |

**Example:**
```bash
npm run render -- -i ./my-song.mp3 -o ./music_video.mp4 -r 4k -f 60 -c ./theme.json
```

---

## Configuration File Schema

When using the CLI renderer, you can pass a JSON file via the `--config` flag to programmatically set the visualizer's state. The configuration object matches the internal state parameters of the React application. 

Here is a full schema example with default values:

```json
{
  "mesh": {
    "depth": 0.55,
    "bevel": 0.045,
    "material": "obsidian", 
    "wireframe": false,
    "edges": true,
    "core": true,
    "halo": true,
    "particles": true,
    "grid": true,
    "extrusionPulse": 0.55
  },
  "glitch": {
    "auto": true,
    "sensitivity": 0.55,
    "rgb": 0.22,
    "slice": 0.12,
    "vertex": 0.85,
    "grain": 0.35,
    "scanline": 0.32,
    "shakeOnBeat": 0.6,
    "invertPulse": false
  },
  "scene": {
    "background": "void", 
    "customColor": "#0d0221",
    "autoOrbit": true,
    "orbitSpeed": 1,
    "trippy": false,
    "fov": 38,
    "vignette": 0.55,
    "speed": 1
  }
}
```

### Parameter Details

#### `mesh`
- **`material`**: `"obsidian" | "chrome" | "neon" | "hologram" | "paper" | "molten"` - The base material theme.
- **`extrusionPulse`**: `number` - How intensely the mesh extrudes to the bass.

#### `glitch`
- **`auto`**: `boolean` - Whether the visualizer should trigger random glitches autonomously based on the beat.
- **`sensitivity`**: `number` - Threshold for auto-glitch triggers.
- **`rgb` / `slice` / `vertex` / `grain` / `scanline`**: `number` - Intensity multipliers for the various shader effects.

#### `scene`
- **`background`**: `"void" | "paper" | "green" | "transparent" | "custom"` - The background environment. Use `"green"` to render a green-screen video for easy chromakeying in video editors.
- **`speed`**: `number` - Overall time multiplier for ambient animations (orbiting, particles). 

## Built With

* [React](https://react.dev/)
* [Three.js](https://threejs.org/) & [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/)
* [Vite](https://vitejs.dev/)
* [Tailwind CSS](https://tailwindcss.com/)
* [Puppeteer](https://pptr.dev/) & [FFmpeg](https://ffmpeg.org/) (for CLI rendering)
