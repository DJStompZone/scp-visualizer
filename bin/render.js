#!/usr/bin/env node

import { Command } from 'commander';
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const program = new Command();

program
  .name('render')
  .description('Render the visualizer to a video file')
  .requiredOption('-i, --input <path>', 'Input audio file')
  .option('-o, --output <path>', 'Output video file', 'output.mkv')
  .option('-r, --resolution <res>', 'Resolution (1080p, 1440p, 4k)', '1080p')
  .option('-f, --fps <fps>', 'Frames per second', '60')
  .option('-c, --config <path>', 'Path to JSON configuration for visuals')
  .option('-s, --start-frame <frame>', 'Frame index to resume rendering from', '0')
  .parse(process.argv);

const options = program.opts();

const resolutions = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 }
};

const res = resolutions[options.resolution.toLowerCase()];
if (!res) {
  console.error(`Invalid resolution: ${options.resolution}. Allowed values: 1080p, 1440p, 4k`);
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), options.input);
const outputPath = path.resolve(process.cwd(), options.output);

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

let configObj = null;
if (options.config) {
  const configPath = path.resolve(process.cwd(), options.config);
  if (fs.existsSync(configPath)) {
    configObj = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } else {
    console.warn(`Config file not found: ${configPath}, proceeding with defaults.`);
  }
}

async function startViteServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting local Vite server...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const server = spawn(npmCmd, ['run', 'dev'], { cwd: rootDir, shell: true });
    
    let buffer = '';
    server.stdout.on('data', (data) => {
      const output = data.toString();
      buffer += output;
      console.log(`[Vite Out]: ${output.trim()}`); 
      
      // Vite injects bold ANSI color codes (\x1B[1m) directly into the middle of the URL 
      // (e.g. http://localhost:\x1B[1m5173), which breaks standard regex matching!
      // We must strip all ANSI codes before matching.
      const cleanBuffer = buffer.replace(/\x1B\[[\d;]*[a-zA-Z]/g, '');
      if (cleanBuffer.includes('Local:')) {
        const match = cleanBuffer.match(/http:\/\/(localhost|127\.0\.0\.1):\d+/);
        if (match) {
          resolve({ server, url: match[0] });
        }
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`[Vite Err]: ${data.toString().trim()}`);
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Vite server exited with code ${code}`));
      }
    });
  });
}

async function render() {
  let viteServer;
  let browser;
  try {
    console.log('[1/4] Starting Vite server...');
    const { server, url } = await startViteServer();
    viteServer = server;
    console.log(`[1/4] Vite server running at ${url}`);

    console.log('[2/4] Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: true, // Updated from 'new' for Puppeteer v22+
      defaultViewport: res,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });
    console.log('[2/4] Puppeteer launched successfully.');

    const page = await browser.newPage();
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.startsWith('[Render]')) {
        console.log(text);
      }
    });

    console.log(`[3/4] Navigating to ${url}/?record=1`);
    await page.goto(`${url}/?record=1`, { waitUntil: 'networkidle0' });

    console.log('Preparing audio chunks for memory-safe FFT processing...');
    const crypto = await import('crypto');
    const os = await import('os');
    const { execSync } = await import('child_process');
    
    // Create a stable, idempotent cache key based on the input file
    const fileStat = fs.statSync(inputPath);
    const hash = crypto.createHash('md5').update(`${inputPath}-${fileStat.mtimeMs}`).digest('hex');
    const tempDir = path.join(os.tmpdir(), `glitchy_audio_chunks_${hash}`);
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`Splitting audio into cache dir: ${tempDir}`);
      // Use ffmpeg to split the file into 10-minute chunks (600s) as PCM WAV
      try {
        execSync(`ffmpeg -y -i "${inputPath}" -f segment -segment_time 600 -c:a pcm_s16le "${path.join(tempDir, 'chunk_%04d.wav')}"`, { stdio: 'ignore' });
      } catch (e) {
        console.error('Failed to split audio:', e);
        throw e;
      }
    } else {
      console.log(`Found cached audio chunks in: ${tempDir}`);
    }

    const chunks = fs.readdirSync(tempDir).filter(f => f.endsWith('.wav')).sort();
    console.log(`Processing ${chunks.length} chunk(s).`);

    // Create an invisible file input to use Puppeteer's native file upload
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'cli-file-upload';
      input.style.display = 'none';
      document.body.appendChild(input);
    });

    let totalFrames = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = path.join(tempDir, chunks[i]);
      console.log(`Computing FFTs for chunk ${i + 1}/${chunks.length}...`);
      
      const fileInput = await page.$('#cli-file-upload');
      await fileInput.uploadFile(chunkPath);

      const chunkFrames = await page.evaluate(async (config, fps, isFirst) => {
        const input = document.getElementById('cli-file-upload');
        const file = input.files[0];
        
        while (!window.initOfflineRender) {
          await new Promise(r => setTimeout(r, 100));
        }
        
        return await window.initOfflineRender(file, config, fps, isFirst);
      }, configObj, parseInt(options.fps), i === 0);

      // Clear the file input to force Chrome to release the file lock
      await page.evaluate(() => {
        document.getElementById('cli-file-upload').value = '';
      });

      totalFrames += chunkFrames;
    }

    // Clean up temporary chunks
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`Pre-computation complete. Total frames to render: ${totalFrames} at ${options.fps} FPS.`);

    console.log('Spawning ffmpeg...');
    let ffmpegCmd = 'ffmpeg';
    
    // Auto-detect hardware encoders for massive speedup
    let hwEncoder = 'libx264';
    try {
      const encoders = execSync('ffmpeg -encoders', { encoding: 'utf-8' });
      if (encoders.includes('h264_nvenc')) hwEncoder = 'h264_nvenc';
      else if (encoders.includes('h264_amf')) hwEncoder = 'h264_amf';
      else if (encoders.includes('h264_qsv')) hwEncoder = 'h264_qsv';
    } catch (e) {}
    
    console.log(`Using H.264 encoder: ${hwEncoder}`);

    const startFrame = parseInt(options.startFrame);
    if (startFrame > 0) {
      console.log(`Resuming render from frame ${startFrame}...`);
    }

    const ffmpegArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg', // Using jpeg for massively faster Puppeteer extraction
      '-r', options.fps.toString(),
      '-i', '-',
      '-ss', (startFrame / parseInt(options.fps)).toString(), // Seek audio to keep sync
      '-i', inputPath,
      '-c:v', hwEncoder,
      '-pix_fmt', 'yuv420p',
      '-preset', hwEncoder === 'libx264' ? 'ultrafast' : 'p4', // Fast preset
      ...(hwEncoder === 'h264_nvenc' ? ['-cq', '20'] : ['-crf', '20']),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-shortest',
      outputPath
    ];

    const ffmpegProcess = spawn(ffmpegCmd, ffmpegArgs);
    
    ffmpegProcess.stderr.on('data', (data) => {
      // Uncomment to debug ffmpeg
      // console.log(`ffmpeg: ${data.toString()}`);
    });

    console.log('Starting frame capture...');
    const startTime = Date.now();
    let frameTimestamps = [];
    const windowMs = 30000;

    for (let i = startFrame; i < totalFrames; i++) {
      await page.evaluate(async (frameIndex) => {
        return new Promise(resolve => {
          window.renderFrameOffline(frameIndex);
          // Wait for React/Three to process and paint
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }, i);

      // JPEG is roughly 5-10x faster to encode in Puppeteer than PNG
      const buffer = await page.screenshot({ type: 'jpeg', quality: 95 });
      
      const writeSuccess = ffmpegProcess.stdin.write(buffer);
      if (!writeSuccess) {
        await new Promise(r => ffmpegProcess.stdin.once('drain', r));
      }

      const now = Date.now();
      frameTimestamps.push(now);
      // Time-based eviction for a true 30-second rolling window
      frameTimestamps = frameTimestamps.filter(t => t > now - windowMs);

      // Update progress bar every 2 frames or on last frame to avoid excessive stdout block
      if (i % 2 === 0 || i === totalFrames - 1) {
        const elapsed = (now - startTime) / 1000;
        
        let currentFps = 0;
        if (frameTimestamps.length > 1) {
          const windowElapsed = (frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0]) / 1000;
          currentFps = (frameTimestamps.length - 1) / windowElapsed;
        } else if (elapsed > 0) {
          currentFps = (i - startFrame + 1) / elapsed;
        }

        const framesRemaining = totalFrames - (i + 1);
        const eta = currentFps > 0 ? framesRemaining / currentFps : 0;
        
        const formatTime = (seconds) => {
          if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          const s = Math.floor(seconds % 60);
          if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
          return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };

        const percent = ((i + 1) / totalFrames);
        const barWidth = 30;
        const completedChars = Math.round(barWidth * percent);
        const bar = '█'.repeat(completedChars) + '░'.repeat(barWidth - completedChars);
        const percentStr = (percent * 100).toFixed(1).padStart(5, ' ');
        
        const output = `\x1b[36m[${bar}]\x1b[0m \x1b[32m${percentStr}%\x1b[0m | Frame \x1b[36m${i + 1}/${totalFrames}\x1b[0m | FPS: \x1b[33m${currentFps.toFixed(1).padStart(4, ' ')}\x1b[0m | Elapsed: \x1b[36m${formatTime(elapsed)}\x1b[0m | ETA: \x1b[33m${formatTime(eta)}\x1b[0m`;
        
        process.stdout.write('\r' + output);
      }
    }
    process.stdout.write('\n');

    console.log('Finished capturing frames. Finalizing video...');
    ffmpegProcess.stdin.end();

    await new Promise((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });

    console.log(`Video saved to ${outputPath}`);

  } catch (err) {
    console.error('Render failed:', err);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (viteServer) {
      viteServer.kill();
    }
    process.exit(0);
  }
}

render();
