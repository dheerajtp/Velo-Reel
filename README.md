# VeloReel

A local, browser-based video editor. Trim a clip, color grade it, add a stats overlay or an image, and export a finished MP4 — all from a web UI running on your own machine. No cloud uploads, no accounts, nothing leaves your computer.

## About

**VeloReel** is a small video editor for quick, local edits — the kind you used to do with desktop apps like iMovie or DaVinci Resolve, but without leaving the browser.

You drop a video into the editor, set an in/out range, pick a look (color grade or preset), optionally add a stats line and/or an image overlay, and export the final MP4. Exports are rendered with FFmpeg on your own machine and downloaded straight from the app.

It started life as a tool for making short vertical (Reels) or square (Feed) clips from existing footage, and grew into a general local editor.

## Features

- **Trim / cut** — set in and out points on the timeline (clamped to a maximum clip length of 10 minutes).
- **Aspect ratios** — export to `9:16` (Reels), `16:9` (YouTube) or `1:1` (Feed) with canvas-matched previews.
- **Color grading** — manual brightness / contrast / saturation / warmth controls plus soft vignette, or jump straight to presets like *Golden hour*, *Punchy*, *Cool morning*, *Muted film*, *Vivid*.
- **Stats overlay** — add a single line of text (e.g. `42.3 km · 310 m`) rendered on the video via FFmpeg `drawtext`.
- **Image overlay** — overlay a PNG/JPG/WebP image (uploaded or pasted via `⌘V` from the clipboard) positioned top/bottom corners, with adjustable size.
- **Export** — renders MP4 via FFmpeg (H.264, AAC audio, faststart) with a live progress bar.

## How it works

```
Browser (public/)  ⇄  Express server (server.js)  ⇄  FFmpeg  ⇄  uploads/ / renders/ / overlays/
```

1. **Upload** — the clip is sent from the browser to `POST /api/upload` and stored in `uploads/`.
2. **Edit** — the UI (Canvas 2D preview) lets you trim, grade and overlay before export.
3. **Render** — `POST /api/render` creates a job that runs FFmpeg with a generated filter graph (`split`, `eq`, `colorbalance`, `gblur`, `drawtext`, `overlay`, …) on a background track and the graded foreground track, with optional vignette and image overlay.
4. **Export** — progress is streamed from FFmpeg's `-progress pipe:1` output; when finished, the result is served from `GET /renders/:file` and downloaded.

Jobs are serialized through a small queue with a single active render at a time.

## Tech stack

- **Backend:** Node.js + Express 5, Multer (file uploads), `ffmpeg-static` (bundled FFmpeg binary)
- **Frontend:** plain HTML/CSS/JS with a Canvas-based preview (no build step, no framework)

## Prerequisites

- **Node.js** (v18+ recommended) and npm
- **FFmpeg** — *not* required to install separately; the app bundles the binary via `ffmpeg-static`

## Getting started

```bash
git clone <your-repo-url> veloreel   # or just copy the project folder
cd veloreel

npm install
npm start
```

Then open:

```
http://127.0.0.1:5173
```

On first run the server (by default on port **5173**, override with the `PORT` env var) creates the following folders if missing:

- `uploads/` — source clips awaiting edit
- `renders/` — exported MP4s
- `overlays/` — user-supplied overlay images

## Usage

1. Click **Choose video** (or drag & drop) on the preview stage. Accepted formats: MP4, MOV, WebM, MKV, AVI. Clips up to ~2 GB.
2. Set **In** / **Out** points with the sliders (out point must be at least 0.3 s after the in point).
3. Pick an aspect ratio (9:16 / 16:9 / 1:1) from the Format section.
4. Apply a color preset or fine-tune brightness, contrast, saturation, warmth and the soft vignette.
5. Optionally enable the **Stats overlay** and type a distance / elevation (e.g. `42.3 km` / `310 m`). One line, bottom-left. Leave a field blank to omit it.
6. Optionally add an image overlay via **Choose**, **Paste image** (`⌘V`) or by dropping an image on the preview; choose position and size.
7. Hit **Export MP4**. Watch the progress bar, then **Download video** when it completes.

While a render is running, uploads/overlays in use can't be deleted (the server returns `409`).

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| Port | `5173` | Override with `PORT=8080 npm start` |
| Max clip length | 600 s | Server clamps trim range (`MAX_CLIP_SECONDS`) |
| Max upload size | 2 GB | Via Multer limit |
| Max overlay image size | 15 MB | Via Multer limit |
| Font used for stats overlay | `Arial Bold` (`/System/Library/Fonts/Supplemental/Arial Bold.ttf`) | macOS only |

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check, reports FFmpeg status and queue depth |
| `POST` | `/api/upload` | Upload a video (multipart, field `video`) |
| `POST` | `/api/overlay-image` | Upload an overlay image (multipart, field `image`) |
| `DELETE` | `/api/upload/:file` | Delete a stored clip |
| `DELETE` | `/api/overlay/:file` | Delete a stored overlay image |
| `GET` | `/media/:file` | Serve an uploaded clip |
| `POST` | `/api/render` | Start a render job (`file`, `start`, `end`, `aspect`, `color`, `overlay`, `image`) |
| `GET` | `/api/render/:id` | Poll job status (`queued` / `running` / `done` / `error`) |
| `GET` | `/renders/:file` | Download the rendered MP4 |

## Limitations

- Preview on the canvas is an approximation; the exported render applies the grade exactly as configured.
- Stats overlay uses a macOS system font (`Arial Bold`) — the filter is hard-coded for that path.
- The render queue processes one job at a time; a 10-minute clip may take a while to encode.
- Trim range is clamped to 600 seconds per clip.

## License

This project is open source — feel free to fork and extend it.
