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
  .option('-o, --output <path>', 'Output video file', 'output.mp4')
  .option('-r, --resolution <res>', 'Resolution (1080p, 1440p, 4k)', '1080p')
  .option('-f, --fps <fps>', 'Frames per second', '60')
  .option('-c, --config <path>', 'Path to JSON configuration for visuals')
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

    console.log('Splitting audio into chunks for memory-safe FFT processing...');
    const tempDir = path.resolve(rootDir, '.temp_audio_chunks');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // Use ffmpeg to split the file into 10-minute chunks (600s) as PCM WAV to ensure exact sample boundaries
    const { execSync } = await import('child_process');
    try {
      execSync(`ffmpeg -y -i "${inputPath}" -f segment -segment_time 600 -c:a pcm_s16le "${path.join(tempDir, 'chunk_%04d.wav')}"`, { stdio: 'ignore' });
    } catch (e) {
      console.error('Failed to split audio:', e);
      throw e;
    }

    const chunks = fs.readdirSync(tempDir).filter(f => f.endsWith('.wav')).sort();
    console.log(`Split audio into ${chunks.length} chunk(s).`);

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

      totalFrames += chunkFrames;
    }

    // Clean up temporary chunks
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`Pre-computation complete. Total frames to render: ${totalFrames} at ${options.fps} FPS.`);

    // Spawn ffmpeg
    console.log('Spawning ffmpeg...');
    const ffmpegCmd = 'ffmpeg';
    const ffmpegArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-r', options.fps.toString(),
      '-i', '-',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'slow',
      '-crf', '18',
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
    let lastLogTime = Date.now();
    for (let i = 0; i < totalFrames; i++) {
      await page.evaluate(async (frameIndex) => {
        return new Promise(resolve => {
          window.renderFrameOffline(frameIndex);
          // Wait for React/Three to process and paint
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }, i);

      const buffer = await page.screenshot({ type: 'png', omitBackground: true });
      
      const writeSuccess = ffmpegProcess.stdin.write(buffer);
      if (!writeSuccess) {
        await new Promise(r => ffmpegProcess.stdin.once('drain', r));
      }

      const now = Date.now();
      if (now - lastLogTime > 2000 || i === totalFrames - 1) {
        console.log(`Rendered frame ${i + 1}/${totalFrames} (${Math.round((i + 1) / totalFrames * 100)}%)`);
        lastLogTime = now;
      }
    }

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
