'use strict';

const express = require('express');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const RENDER_DIR = path.join(ROOT, 'renders');
const OVERLAY_DIR = path.join(ROOT, 'overlays');
const FONT_FILE = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RENDER_DIR, { recursive: true });
fs.mkdirSync(OVERLAY_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const looksLikeVideo =
      /^video\//.test(file.mimetype) ||
      /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname);
    if (!looksLikeVideo) {
      return cb(new Error('Choose an MP4, MOV, WebM, MKV, or AVI clip.'));
    }
    cb(null, true);
  },
});

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const overlayUpload = multer({
  storage: multer.diskStorage({
    destination: OVERLAY_DIR,
    filename: (req, file, cb) => {
      const ext =
        IMAGE_EXT[file.mimetype] ||
        path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') ||
        '.png';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const looksLikeImage =
      Boolean(IMAGE_EXT[file.mimetype]) ||
      /\.(png|jpe?g|webp)$/i.test(file.originalname);
    if (!looksLikeImage) {
      return cb(new Error('Choose a PNG, JPG, or WebP image.'));
    }
    cb(null, true);
  },
});

const ASPECTS = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
};

const MAX_CLIP_SECONDS = 600;
const IMAGE_POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value, max = 40) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeConfig(body) {
  if (!body || typeof body !== 'object') return null;
  const file = path.basename(String(body.file || ''));
  if (!file || file !== String(body.file)) return null;
  const aspect = ASPECTS[body.aspect] ? body.aspect : null;
  if (!aspect) return null;

  const start = clamp(body.start, 0, MAX_CLIP_SECONDS, 0);
  const end = clamp(body.end, 0, MAX_CLIP_SECONDS, 0);
  const duration = end - start;
  if (duration < 0.3) return null;

  const color = body.color && typeof body.color === 'object' ? body.color : {};
  const overlay = body.overlay && typeof body.overlay === 'object' ? body.overlay : {};

  let image = null;
  if (body.image) {
    if (typeof body.image !== 'object') return null;
    const imageFile = path.basename(String(body.image.file || ''));
    if (!imageFile || imageFile !== String(body.image.file)) return null;
    if (!/\.(png|jpe?g|webp)$/i.test(imageFile)) return null;
    const imagePath = path.join(OVERLAY_DIR, imageFile);
    if (!fs.existsSync(imagePath)) return null;
    image = {
      file: imageFile,
      path: imagePath,
      position: IMAGE_POSITIONS.has(body.image.position) ? body.image.position : 'top-right',
      scale: clamp(body.image.scale, 0.1, 0.6, 0.3),
    };
  }

  return {
    file,
    aspect,
    start,
    end,
    duration,
    brightness: clamp(color.brightness, -0.3, 0.3, 0),
    contrast: clamp(color.contrast, 0.6, 1.6, 1),
    saturation: clamp(color.saturation, 0, 2, 1),
    warmth: clamp(color.warmth, -1, 1, 0),
    vignette: Boolean(color.vignette),
    showOverlay: Boolean(overlay.show),
    distance: cleanText(overlay.distance),
    elevation: cleanText(overlay.elevation),
    image,
  };
}

function buildFilter(cfg, textFile) {
  const { w, h } = ASPECTS[cfg.aspect];
  const shortSide = Math.min(w, h);
  const margin = Math.round(shortSide * 0.055);
  const warmth = cfg.warmth * 0.22;
  const blur = Math.max(12, Math.round(shortSide * 0.035));

  const parts = [
    '[0:v]split=2[bg][fg]',
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=${blur},eq=brightness=-0.12[bg2]`,
    `[fg]eq=brightness=${cfg.brightness.toFixed(3)}:contrast=${cfg.contrast.toFixed(3)}:saturation=${cfg.saturation.toFixed(3)},colorbalance=rs=${warmth.toFixed(3)}:gs=0:bs=${(-warmth).toFixed(3)},scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg2]`,
    '[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[base]',
  ];

  let last = 'base';
  if (cfg.vignette) {
    parts.push('[base]vignette=angle=PI/5[vig]');
    last = 'vig';
  }

  if (cfg.image) {
    const imageWidth = Math.max(2, Math.round((w * cfg.image.scale) / 2) * 2);
    const x = cfg.image.position.endsWith('right') ? `W-w-${margin}` : String(margin);
    const y = cfg.image.position.startsWith('bottom') ? `H-h-${margin}` : String(margin);
    parts.push(`[1:v]scale=${imageWidth}:-2[img]`);
    parts.push(`[${last}][img]overlay=${x}:${y}[imgbase]`);
    last = 'imgbase';
  }

  const overlayText = [cfg.distance, cfg.elevation].filter(Boolean).join('  \u00b7  ');
  if (cfg.showOverlay && overlayText && textFile) {
    const fontSize = Math.round(shortSide * 0.05);
    const border = Math.round(fontSize * 0.4);
    parts.push(
      `[${last}]drawtext=fontfile='${FONT_FILE}':textfile='${textFile}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.38:boxborderw=${border}:x=${margin}:y=h-th-${margin}:shadowcolor=black@0.45:shadowx=2:shadowy=2[outv]`,
    );
  } else {
    parts.push(`[${last}]null[outv]`);
  }

  return parts.join(';');
}

const jobs = new Map();
const queue = [];
let active = null;

function enqueue(job) {
  jobs.set(job.id, job);
  queue.push(job);
  pump();
}

function pump() {
  if (active || queue.length === 0) return;
  active = queue.shift();
  runJob(active);
}

function finishJob(job, status, error) {
  job.status = status;
  job.error = error || null;
  if (status === 'done') job.progress = 100;
  if (job.textFile) {
    fs.rm(job.textFile, { force: true }, () => {});
  }
  active = null;
  pump();
}

function runJob(job) {
  const { cfg, source, output, textFile } = job;
  job.status = 'running';

  const filter = buildFilter(cfg, textFile);
  const args = [
    '-hide_banner',
    '-y',
    '-ss', String(cfg.start),
    '-i', source,
  ];
  if (cfg.image) {
    args.push('-i', cfg.image.path);
  }
  args.push(
    '-t', String(cfg.duration),
    '-filter_complex', filter,
    '-map', '[outv]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    output,
  );

  let stderr = '';
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
      if (!match) continue;
      const seconds = Number(match[1]) / 1e6;
      const pct = Math.min(99, Math.max(0, Math.round((seconds / cfg.duration) * 100)));
      if (pct > job.progress) job.progress = pct;
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 24000) stderr = stderr.slice(-24000);
  });

  child.on('error', (err) => {
    finishJob(job, 'error', `Could not start FFmpeg: ${err.message}`);
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(output)) {
      finishJob(job, 'done');
      return;
    }
    const tail = stderr
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-4)
      .join(' ');
    finishJob(job, 'error', tail || `FFmpeg exited with code ${code}.`);
  });
}

app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'That clip is over the 2 GB limit.'
          : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'No video was uploaded.' });
    res.json({ file: req.file.filename, size: req.file.size });
  });
});

app.post('/api/overlay-image', (req, res) => {
  overlayUpload.single('image')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'That image is over the 15 MB limit.'
          : err.message || 'Image upload failed.';
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'No image was uploaded.' });
    res.json({ file: req.file.filename, size: req.file.size });
  });
});

app.delete('/api/overlay/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!file || file !== req.params.file) return res.sendStatus(400);

  const inUse =
    (active && active.cfg.image && active.cfg.image.file === file) ||
    queue.some((job) => job.cfg.image && job.cfg.image.file === file);
  if (inUse) return res.status(409).json({ error: 'A render is using this image.' });

  fs.rm(path.join(OVERLAY_DIR, file), { force: true }, (err) => {
    if (err) return res.sendStatus(500);
    res.sendStatus(204);
  });
});

app.delete('/api/upload/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!file || file !== req.params.file) return res.sendStatus(400);

  const inUse =
    (active && active.cfg.file === file) ||
    queue.some((job) => job.cfg.file === file);
  if (inUse) return res.status(409).json({ error: 'A render is using this clip.' });

  fs.rm(path.join(UPLOAD_DIR, file), { force: true }, (err) => {
    if (err) return res.sendStatus(500);
    res.sendStatus(204);
  });
});

app.get('/media/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (file !== req.params.file) return res.sendStatus(400);
  const full = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(full)) return res.sendStatus(404);
  res.sendFile(full);
});

app.post('/api/render', (req, res) => {
  const cfg = normalizeConfig(req.body);
  if (!cfg) {
    return res.status(400).json({
      error: 'Check the trim range, format, clip selection, and overlay image.',
    });
  }

  const source = path.join(UPLOAD_DIR, cfg.file);
  if (!fs.existsSync(source)) {
    return res.status(404).json({ error: 'Upload not found. Choose the clip again.' });
  }

  const id = crypto.randomUUID();
  const outputName = `veloreel-${Date.now()}-${id.slice(0, 8)}.mp4`;
  const output = path.join(RENDER_DIR, outputName);

  let textFile = null;
  const overlayText = [cfg.distance, cfg.elevation].filter(Boolean).join('  \u00b7  ');
  if (cfg.showOverlay && overlayText) {
    textFile = path.join(os.tmpdir(), `veloreel-${id}.txt`);
    fs.writeFileSync(textFile, overlayText, 'utf8');
  }

  enqueue({
    id,
    cfg,
    source,
    output,
    outputName,
    textFile,
    status: 'queued',
    progress: 0,
    error: null,
    createdAt: Date.now(),
  });

  res.json({ id });
});

app.get('/api/render/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    url: job.status === 'done' ? `/renders/${job.outputName}` : null,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ffmpeg: Boolean(ffmpegPath), active: active ? active.id : null, queued: queue.length });
});

app.use('/renders', express.static(RENDER_DIR, { maxAge: '1h' }));

app.use((err, req, res, next) => {
  if (err) {
    return res.status(500).json({ error: err.message || 'Server error.' });
  }
  next();
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`VeloReel running at http://127.0.0.1:${PORT}`);
});

function shutdown() {
  if (active && active.child) {
    active.child.kill('SIGINT');
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
