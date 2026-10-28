(() => {
  'use strict';

  const FORMATS = {
    '9:16': { w: 405, h: 720 },
    '16:9': { w: 720, h: 405 },
    '1:1': { w: 540, h: 540 },
  };
  const MAX_EXPORT_SECONDS = 600;

  const PRESETS = {
    natural: {
      label: 'Natural',
      brightness: 0,
      contrast: 1,
      saturation: 1,
      warmth: 0,
      vignette: false,
      swatch: 'linear-gradient(135deg,#7f8c7a,#c7d2c0)',
    },
    golden: {
      label: 'Golden hour',
      brightness: 0.04,
      contrast: 1.06,
      saturation: 1.15,
      warmth: 0.45,
      vignette: false,
      swatch: 'linear-gradient(135deg,#e08b3c,#ffd9a0)',
    },
    punchy: {
      label: 'Punchy',
      brightness: 0.01,
      contrast: 1.18,
      saturation: 1.3,
      warmth: 0.1,
      vignette: true,
      swatch: 'linear-gradient(135deg,#e05b4a,#ffc15e)',
    },
    cool: {
      label: 'Cool morning',
      brightness: 0.02,
      contrast: 1.05,
      saturation: 0.95,
      warmth: -0.35,
      vignette: false,
      swatch: 'linear-gradient(135deg,#4d8fd6,#cfe6ff)',
    },
    film: {
      label: 'Muted film',
      brightness: -0.02,
      contrast: 0.92,
      saturation: 0.8,
      warmth: 0.15,
      vignette: true,
      swatch: 'linear-gradient(135deg,#8a7a68,#d8c9b6)',
    },
    vivid: {
      label: 'Vivid',
      brightness: 0,
      contrast: 1.12,
      saturation: 1.45,
      warmth: 0.05,
      vignette: false,
      swatch: 'linear-gradient(135deg,#ff5da2,#6ff0c4)',
    },
  };

  const $ = (selector) => document.querySelector(selector);

  const video = $('#video');
  const canvas = $('#preview');
  const ctx = canvas.getContext('2d');
  const dropZone = $('#dropZone');
  const emptyState = $('#emptyState');
  const chooseBtn = $('#chooseBtn');
  const fileInput = $('#fileInput');
  const changeBtn = $('#changeBtn');
  const removeBtn = $('#removeBtn');
  const clipName = $('#clipName');
  const clipHint = $('#clipHint');
  const startRange = $('#startRange');
  const endRange = $('#endRange');
  const startOut = $('#startOut');
  const endOut = $('#endOut');
  const playBtn = $('#playBtn');
  const timeLabel = $('#timeLabel');
  const scrub = $('#scrub');
  const uploadStatus = $('#uploadStatus');
  const presetsEl = $('#presets');
  const brightness = $('#brightness');
  const contrast = $('#contrast');
  const saturation = $('#saturation');
  const warmth = $('#warmth');
  const vignette = $('#vignette');
  const brightnessOut = $('#brightnessOut');
  const contrastOut = $('#contrastOut');
  const saturationOut = $('#saturationOut');
  const warmthOut = $('#warmthOut');
  const overlayShow = $('#overlayShow');
  const distanceInput = $('#distance');
  const elevationInput = $('#elevation');
  const imageInput = $('#imageInput');
  const imageChooseBtn = $('#imageChooseBtn');
  const imagePasteBtn = $('#imagePasteBtn');
  const imageRemoveBtn = $('#imageRemoveBtn');
  const imageName = $('#imageName');
  const imageStatus = $('#imageStatus');
  const imageSize = $('#imageSize');
  const imageSizeOut = $('#imageSizeOut');
  const positionButtons = Array.from(document.querySelectorAll('[data-position]'));
  const exportBtn = $('#exportBtn');
  const barFill = $('#barFill');
  const exportStatus = $('#exportStatus');
  const downloadLink = $('#downloadLink');
  const resetBtn = $('#resetBtn');

  const state = {
    file: null,
    uploadFile: null,
    objectUrl: null,
    duration: 0,
    start: 0,
    end: 0,
    aspect: '9:16',
    color: { brightness: 0, contrast: 1, saturation: 1, warmth: 0, vignette: false },
    overlay: { show: true, distance: '', elevation: '' },
    image: {
      file: null,
      serverFile: null,
      url: null,
      el: null,
      position: 'top-right',
      scale: 0.3,
    },
    playing: false,
    rendering: false,
    draggingScrub: false,
  };

  let uploadSeq = 0;
  let uploadXhr = null;
  let renderSeq = 0;
  let imageUploadSeq = 0;
  let imageAbort = null;

  function fmt(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;
    const minutes = Math.floor(t / 60);
    const seconds = t - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }

  function signed(n) {
    return n > 0 ? `+${n}` : String(n);
  }

  function setUploadStatus(text, isError = false) {
    uploadStatus.textContent = text;
    uploadStatus.classList.toggle('is-error', isError);
  }

  function setExportStatus(text, isError = false) {
    exportStatus.textContent = text;
    exportStatus.classList.toggle('is-error', isError);
  }

  function setImageStatus(text, isError = false) {
    imageStatus.textContent = text;
    imageStatus.classList.toggle('is-error', isError);
  }

  function syncImageUI() {
    const hasImage = Boolean(state.image.file);
    imageName.textContent = hasImage ? state.image.file.name || 'Pasted image' : 'No image';
    imageName.title = hasImage ? imageName.textContent : '';
    imageRemoveBtn.disabled = !hasImage;
    imageSize.disabled = !hasImage;
    imageSize.value = String(Math.round(state.image.scale * 100));
    imageSizeOut.textContent = `${Math.round(state.image.scale * 100)}%`;
    positionButtons.forEach((btn) => {
      btn.disabled = !hasImage;
      btn.classList.toggle('active', btn.dataset.position === state.image.position);
    });
  }

  function syncExportButton() {
    const imageReady = !state.image.file || Boolean(state.image.serverFile);
    exportBtn.disabled = !state.uploadFile || !imageReady || state.rendering;
  }

  function setAspect(aspect) {
    if (!FORMATS[aspect]) return;
    state.aspect = aspect;
    canvas.width = FORMATS[aspect].w;
    canvas.height = FORMATS[aspect].h;
    document.querySelectorAll('[data-aspect]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.aspect === aspect);
    });
  }

  function updateColorOutputs() {
    brightnessOut.textContent = signed(Math.round(state.color.brightness * 100));
    contrastOut.textContent = `${Math.round(state.color.contrast * 100)}%`;
    saturationOut.textContent = `${Math.round(state.color.saturation * 100)}%`;
    warmthOut.textContent = signed(Math.round(state.color.warmth * 100));
  }

  function markPreset() {
    let matched = null;
    for (const [key, preset] of Object.entries(PRESETS)) {
      if (
        Math.abs(preset.brightness - state.color.brightness) < 0.005 &&
        Math.abs(preset.contrast - state.color.contrast) < 0.005 &&
        Math.abs(preset.saturation - state.color.saturation) < 0.005 &&
        Math.abs(preset.warmth - state.color.warmth) < 0.005 &&
        preset.vignette === state.color.vignette
      ) {
        matched = key;
        break;
      }
    }
    presetsEl.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === matched);
    });
  }

  function syncColorUI() {
    brightness.value = String(Math.round(state.color.brightness * 100));
    contrast.value = String(Math.round(state.color.contrast * 100));
    saturation.value = String(Math.round(state.color.saturation * 100));
    warmth.value = String(Math.round(state.color.warmth * 100));
    vignette.checked = state.color.vignette;
    updateColorOutputs();
    markPreset();
  }

  function applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    state.color = {
      brightness: preset.brightness,
      contrast: preset.contrast,
      saturation: preset.saturation,
      warmth: preset.warmth,
      vignette: preset.vignette,
    };
    syncColorUI();
  }

  function buildPresets() {
    Object.entries(PRESETS).forEach(([key, preset]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.preset = key;
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = preset.swatch;
      const label = document.createElement('span');
      label.textContent = preset.label;
      btn.append(swatch, label);
      btn.addEventListener('click', () => applyPreset(key));
      presetsEl.append(btn);
    });
  }

  function drawCover(source, vw, vh, W, H) {
    const scale = Math.max(W / vw, H / vh);
    const w = vw * scale;
    const h = vh * scale;
    ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
  }

  function drawContain(source, vw, vh, W, H) {
    const scale = Math.min(W / vw, H / vh);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    ctx.drawImage(source, x, y, w, h);
    return { x, y, w, h };
  }

  function drawImageOverlay(W, H) {
    const image = state.image.el;
    if (!image || !image.complete || !image.naturalWidth) return;

    const margin = Math.round(Math.min(W, H) * 0.055);
    const width = Math.round(W * state.image.scale);
    const height = Math.round((width * image.naturalHeight) / image.naturalWidth);
    const right = state.image.position === 'top-right' || state.image.position === 'bottom-right';
    const bottom =
      state.image.position === 'bottom-left' || state.image.position === 'bottom-right';
    const x = right ? W - width - margin : margin;
    const y = bottom ? H - height - margin : margin;

    ctx.drawImage(image, x, y, width, height);
  }

  function drawOverlay(W, H) {
    const text = [state.overlay.distance, state.overlay.elevation]
      .filter(Boolean)
      .join('  \u00b7  ');
    if (!state.overlay.show || !text) return;

    const shortSide = Math.min(W, H);
    const fontSize = Math.round(shortSide * 0.05);
    const margin = Math.round(shortSide * 0.055);
    const padX = Math.round(fontSize * 0.4);
    const padY = Math.round(fontSize * 0.28);

    ctx.save();
    ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + padX * 2;
    const boxH = fontSize + padY * 2;
    const x = margin;
    const y = H - margin - boxH;

    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + padX, y + boxH / 2 + 1);
    ctx.restore();
  }

  function drawFrame() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (video.readyState >= 2 && video.videoWidth > 0) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      ctx.save();
      ctx.filter = `blur(${Math.max(6, Math.round(Math.min(W, H) * 0.035))}px) brightness(0.55)`;
      drawCover(video, vw, vh, W, H);
      ctx.filter = 'none';

      ctx.filter = `brightness(${1 + state.color.brightness}) contrast(${state.color.contrast}) saturate(${state.color.saturation})`;
      const fg = drawContain(video, vw, vh, W, H);
      ctx.filter = 'none';

      if (Math.abs(state.color.warmth) > 0.001) {
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        const alpha = Math.min(0.5, Math.abs(state.color.warmth) * 0.38);
        ctx.fillStyle =
          state.color.warmth > 0 ? `rgba(255,146,48,${alpha})` : `rgba(54,132,255,${alpha})`;
        ctx.fillRect(fg.x, fg.y, fg.w, fg.h);
        ctx.restore();
      }

      if (state.color.vignette) {
        const gradient = ctx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.32,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.72,
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, H);
      }

      drawImageOverlay(W, H);
      drawOverlay(W, H);
      ctx.restore();

      if (!video.paused && state.duration && video.currentTime >= state.end - 0.02) {
        video.currentTime = state.start;
      }
    } else {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, W, H);
    }

    if (state.duration) {
      if (!state.draggingScrub) scrub.value = String(video.currentTime);
      timeLabel.textContent = `${fmt(video.currentTime)} / ${fmt(state.end)}`;
    }

    requestAnimationFrame(drawFrame);
  }

  function syncClipButtons() {
    changeBtn.disabled = !state.file;
    removeBtn.disabled = !state.file;
  }

  function resetForNewClip() {
    renderSeq += 1;
    state.uploadFile = null;
    state.rendering = false;
    downloadLink.hidden = true;
    downloadLink.removeAttribute('href');
    barFill.style.width = '0%';
    setExportStatus('Load a clip to export.');
    startRange.disabled = true;
    endRange.disabled = true;
    scrub.disabled = true;
    playBtn.disabled = true;
    syncExportButton();
    syncClipButtons();
  }

  function stopUpload() {
    uploadSeq += 1;
    if (uploadXhr) {
      const xhr = uploadXhr;
      uploadXhr = null;
      xhr.abort();
    }
  }

  function discardUpload(name) {
    if (!name) return;
    fetch(`/api/upload/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  }

  function stopImageUpload() {
    imageUploadSeq += 1;
    if (imageAbort) {
      const controller = imageAbort;
      imageAbort = null;
      controller.abort();
    }
  }

  function discardOverlay(name) {
    if (!name) return;
    fetch(`/api/overlay/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  }

  async function uploadOverlayImage(file, seq) {
    const controller = new AbortController();
    imageAbort = controller;
    setImageStatus('Uploading image…');
    if (state.uploadFile) setExportStatus('Wait for the image upload to finish.');

    const form = new FormData();
    form.append('image', file);

    try {
      const res = await fetch('/api/overlay-image', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (seq !== imageUploadSeq) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.file) throw new Error(data.error || 'Image upload failed.');
      state.image.serverFile = data.file;
      setImageStatus('Image ready.');
      if (state.uploadFile) setExportStatus('Ready to export.');
      syncExportButton();
    } catch (err) {
      if (seq !== imageUploadSeq || err.name === 'AbortError') return;
      setImageStatus(err.message || 'Image upload failed.', true);
      setExportStatus('Image upload failed. Remove it or choose another.', true);
      syncExportButton();
    } finally {
      if (imageAbort === controller) imageAbort = null;
    }
  }

  function loadOverlayImage(file) {
    if (!file) return;
    const allowed =
      /^image\/(png|jpeg|webp)$/.test(file.type) ||
      /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!allowed) {
      setImageStatus('Choose a PNG, JPG, or WebP image.', true);
      return;
    }

    const previous = state.image.serverFile;
    stopImageUpload();
    if (previous) discardOverlay(previous);
    if (state.image.url) URL.revokeObjectURL(state.image.url);

    const url = URL.createObjectURL(file);
    state.image.file = file;
    state.image.serverFile = null;
    state.image.url = url;
    state.image.el = null;

    const image = new Image();
    image.onload = () => {
      if (state.image.url === url) state.image.el = image;
    };
    image.onerror = () => {
      if (state.image.url === url) setImageStatus('That image could not be read.', true);
    };
    image.src = url;

    if (!state.rendering) {
      downloadLink.hidden = true;
      downloadLink.removeAttribute('href');
      barFill.style.width = '0%';
    }
    syncImageUI();
    syncExportButton();
    uploadOverlayImage(file, ++imageUploadSeq);
  }

  function removeOverlayImage() {
    if (!state.image.file) return;
    stopImageUpload();
    const previous = state.image.serverFile;
    if (state.image.url) URL.revokeObjectURL(state.image.url);
    state.image.file = null;
    state.image.serverFile = null;
    state.image.url = null;
    state.image.el = null;
    discardOverlay(previous);
    setImageStatus('');
    if (!state.rendering) {
      downloadLink.hidden = true;
      downloadLink.removeAttribute('href');
      barFill.style.width = '0%';
      if (state.uploadFile) setExportStatus('Ready to export.');
    }
    syncImageUI();
    syncExportButton();
  }

  function unloadClip() {
    if (!state.file) return;
    stopUpload();

    video.pause();
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();

    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }

    const previousUpload = state.uploadFile;
    state.file = null;
    state.uploadFile = null;
    state.duration = 0;
    state.start = 0;
    state.end = 0;
    state.playing = false;
    state.draggingScrub = false;

    resetForNewClip();
    discardUpload(previousUpload);

    clipName.textContent = 'No clip loaded';
    emptyState.hidden = false;

    startRange.min = '0';
    startRange.max = '0';
    startRange.value = '0';
    endRange.min = '0.3';
    endRange.max = '0';
    endRange.value = '0';
    scrub.min = '0';
    scrub.max = '0';
    scrub.value = '0';
    startOut.textContent = fmt(0);
    endOut.textContent = fmt(0);
    timeLabel.textContent = `${fmt(0)} / ${fmt(0)}`;
    clipHint.textContent = 'Load a clip to trim it.';
    setUploadStatus('');
    fileInput.value = '';
    chooseBtn.focus();
  }

  function uploadClip(file) {
    const seq = ++uploadSeq;
    const form = new FormData();
    form.append('video', file);

    const xhr = new XMLHttpRequest();
    uploadXhr = xhr;
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (event) => {
      if (seq !== uploadSeq) return;
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setUploadStatus(`Uploading… ${pct}%`);
      }
    };
    xhr.onload = () => {
      if (uploadXhr === xhr) uploadXhr = null;
      if (seq !== uploadSeq) return;
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.file) {
        state.uploadFile = data.file;
        setUploadStatus('Clip ready.');
        if (state.image.file && !state.image.serverFile) {
          setExportStatus('Wait for the image upload to finish.');
        } else {
          setExportStatus('Ready to export.');
        }
        syncExportButton();
      } else {
        const message = (data && data.error) || 'Upload failed.';
        setUploadStatus(message, true);
        setExportStatus('Upload failed. Choose the clip again.', true);
        syncExportButton();
      }
    };
    xhr.onerror = () => {
      if (uploadXhr === xhr) uploadXhr = null;
      if (seq !== uploadSeq) return;
      setUploadStatus('Upload failed.', true);
      setExportStatus('Upload failed. Is the local server running?', true);
    };
    xhr.send(form);
  }

  function loadFile(file) {
    if (!file) return;
    const looksLikeVideo =
      (file.type && file.type.startsWith('video/')) ||
      /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
    if (!looksLikeVideo) {
      setUploadStatus('Choose an MP4, MOV, or WebM clip.', true);
      return;
    }

    const previousUpload = state.uploadFile;
    stopUpload();
    resetForNewClip();
    if (previousUpload) discardUpload(previousUpload);

    state.file = file;
    state.duration = 0;
    state.start = 0;
    state.end = 0;
    state.playing = false;
    clipName.textContent = file.name;
    emptyState.hidden = true;
    syncClipButtons();
    setUploadStatus('Loading clip…');

    const url = URL.createObjectURL(file);
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = url;

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const maxEnd = Math.min(duration, MAX_EXPORT_SECONDS);
      state.duration = duration;
      state.start = 0;
      state.end = maxEnd;

      startRange.min = '0';
      startRange.max = String(Math.max(0, maxEnd - 0.3));
      startRange.value = '0';
      startRange.disabled = maxEnd < 0.3;

      endRange.min = '0.3';
      endRange.max = String(maxEnd);
      endRange.value = String(maxEnd);
      endRange.disabled = maxEnd < 0.3;

      scrub.min = '0';
      scrub.max = String(maxEnd);
      scrub.value = '0';
      scrub.disabled = maxEnd < 0.3;

      playBtn.disabled = maxEnd < 0.3;
      startOut.textContent = fmt(0);
      endOut.textContent = fmt(maxEnd);
      timeLabel.textContent = `${fmt(0)} / ${fmt(maxEnd)}`;
      clipHint.textContent =
        duration > MAX_EXPORT_SECONDS
          ? 'Exports are capped at 10 minutes. Trim to the best part.'
          : 'Set in and out points for the edit.';

      video.currentTime = 0;
      video.pause();
    };

    video.onerror = () => {
      setUploadStatus('That clip could not be read.', true);
      setExportStatus('Try a different file.', true);
    };

    video.src = url;
    video.load();
    uploadClip(file);
  }

  function togglePlay() {
    if (!state.file || !state.duration) return;
    if (video.paused) {
      if (video.currentTime < state.start || video.currentTime >= state.end) {
        video.currentTime = state.start;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function exportVideo() {
    if (state.rendering) return;
    if (!state.uploadFile) {
      setExportStatus('Wait for the upload to finish, then export.', true);
      return;
    }
    if (state.image.file && !state.image.serverFile) {
      setExportStatus('Wait for the image upload to finish.', true);
      return;
    }
    if (state.end - state.start < 0.3) {
      setExportStatus('Set an out point at least 0.3s after the in point.', true);
      return;
    }

    const seq = ++renderSeq;
    state.rendering = true;
    syncExportButton();
    downloadLink.hidden = true;
    barFill.style.width = '0%';
    setExportStatus('Queued…');

    fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: state.uploadFile,
        start: Number(state.start.toFixed(2)),
        end: Number(state.end.toFixed(2)),
        aspect: state.aspect,
        color: state.color,
        overlay: state.overlay,
        image: state.image.serverFile
          ? {
              file: state.image.serverFile,
              position: state.image.position,
              scale: state.image.scale,
            }
          : null,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Export failed.');
        return data;
      })
      .then((data) => pollJob(data.id, seq))
      .catch((err) => {
        if (seq !== renderSeq) return;
        state.rendering = false;
        syncExportButton();
        setExportStatus(err.message || 'Export failed.', true);
      });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollJob(id, seq) {
    const started = Date.now();
    while (state.rendering && seq === renderSeq) {
      await sleep(700);
      if (seq !== renderSeq) return;
      let data;
      try {
        const res = await fetch(`/api/render/${id}`);
        if (!res.ok) throw new Error('Render job disappeared.');
        data = await res.json();
      } catch (err) {
        if (seq !== renderSeq) return;
        state.rendering = false;
        syncExportButton();
        setExportStatus(err.message, true);
        return;
      }

      if (seq !== renderSeq) return;

      if (data.status === 'done') {
        state.rendering = false;
        syncExportButton();
        barFill.style.width = '100%';
        setExportStatus('Export complete. MP4 is ready.');
        downloadLink.href = data.url;
        downloadLink.download = `veloreel-${Date.now()}.mp4`;
        downloadLink.hidden = false;
        return;
      }

      if (data.status === 'error') {
        state.rendering = false;
        syncExportButton();
        barFill.style.width = '0%';
        setExportStatus(data.error || 'Export failed.', true);
        return;
      }

      barFill.style.width = `${Math.max(4, data.progress)}%`;
      setExportStatus(data.status === 'queued' ? 'Queued…' : `Rendering… ${data.progress}%`);

      if (Date.now() - started > 30 * 60 * 1000) {
        state.rendering = false;
        syncExportButton();
        setExportStatus('Export timed out. Try a shorter clip.', true);
        return;
      }
    }
  }

  function wireEvents() {
    chooseBtn.addEventListener('click', () => fileInput.click());
    changeBtn.addEventListener('click', () => fileInput.click());
    removeBtn.addEventListener('click', unloadClip);

    imageChooseBtn.addEventListener('click', () => imageInput.click());
    imageRemoveBtn.addEventListener('click', removeOverlayImage);
    imageInput.addEventListener('change', () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = '';
      loadOverlayImage(file);
    });
    imagePasteBtn.addEventListener('click', async () => {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        setImageStatus('Press ⌘V to paste instead.', true);
        return;
      }
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((value) => /^image\/(png|jpeg|webp)$/.test(value));
          if (!type) continue;
          const blob = await item.getType(type);
          const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
          loadOverlayImage(new File([blob], `pasted.${ext}`, { type }));
          return;
        }
        setImageStatus('No image on the clipboard.', true);
      } catch {
        setImageStatus('Clipboard access was blocked. Press ⌘V instead.', true);
      }
    });
    positionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.image.position = btn.dataset.position;
        syncImageUI();
      });
    });
    imageSize.addEventListener('input', () => {
      state.image.scale = Number(imageSize.value) / 100;
      imageSizeOut.textContent = `${imageSize.value}%`;
    });
    document.addEventListener('paste', (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind !== 'file' || !/^image\/(png|jpeg|webp)$/.test(item.type)) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        loadOverlayImage(file);
        return;
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      loadFile(file);
    });

    ['dragenter', 'dragover'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === 'dragleave' && dropZone.contains(event.relatedTarget)) return;
        dropZone.classList.remove('is-dragging');
      });
    });
    dropZone.addEventListener('drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      if ((file.type && file.type.startsWith('image/')) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        loadOverlayImage(file);
      } else {
        loadFile(file);
      }
    });
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => event.preventDefault());

    canvas.addEventListener('click', togglePlay);
    playBtn.addEventListener('click', togglePlay);

    video.addEventListener('play', () => {
      state.playing = true;
      playBtn.textContent = 'Pause';
    });
    video.addEventListener('pause', () => {
      state.playing = false;
      playBtn.textContent = 'Play';
    });

    startRange.addEventListener('input', () => {
      let value = Number(startRange.value);
      const maxStart = Math.max(0, state.end - 0.3);
      if (value > maxStart) {
        value = maxStart;
        startRange.value = String(value);
      }
      state.start = value;
      startOut.textContent = fmt(value);
      endRange.min = String(value + 0.3);
      if (video.currentTime < value) video.currentTime = value;
    });

    endRange.addEventListener('input', () => {
      let value = Number(endRange.value);
      const minEnd = state.start + 0.3;
      if (value < minEnd) {
        value = minEnd;
        endRange.value = String(value);
      }
      state.end = value;
      endOut.textContent = fmt(value);
      startRange.max = String(Math.max(0, value - 0.3));
      if (video.currentTime > value) video.currentTime = value;
    });

    scrub.addEventListener('pointerdown', () => {
      state.draggingScrub = true;
    });
    window.addEventListener('pointerup', () => {
      state.draggingScrub = false;
    });
    scrub.addEventListener('input', () => {
      if (!state.duration) return;
      video.currentTime = Number(scrub.value);
    });

    document.querySelectorAll('[data-aspect]').forEach((btn) => {
      btn.addEventListener('click', () => setAspect(btn.dataset.aspect));
    });

    brightness.addEventListener('input', () => {
      state.color.brightness = Number(brightness.value) / 100;
      updateColorOutputs();
      markPreset();
    });
    contrast.addEventListener('input', () => {
      state.color.contrast = Number(contrast.value) / 100;
      updateColorOutputs();
      markPreset();
    });
    saturation.addEventListener('input', () => {
      state.color.saturation = Number(saturation.value) / 100;
      updateColorOutputs();
      markPreset();
    });
    warmth.addEventListener('input', () => {
      state.color.warmth = Number(warmth.value) / 100;
      updateColorOutputs();
      markPreset();
    });
    vignette.addEventListener('change', () => {
      state.color.vignette = vignette.checked;
      markPreset();
    });

    overlayShow.addEventListener('change', () => {
      state.overlay.show = overlayShow.checked;
    });
    distanceInput.addEventListener('input', () => {
      state.overlay.distance = distanceInput.value;
    });
    elevationInput.addEventListener('input', () => {
      state.overlay.elevation = elevationInput.value;
    });

    exportBtn.addEventListener('click', exportVideo);
    resetBtn.addEventListener('click', () => applyPreset('natural'));

    window.addEventListener('keydown', (event) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (event.code === 'Space' && !/INPUT|TEXTAREA|BUTTON|SELECT/.test(tag)) {
        event.preventDefault();
        togglePlay();
      }
    });
  }

  buildPresets();
  setAspect('9:16');
  syncColorUI();
  wireEvents();
  syncClipButtons();
  syncImageUI();
  syncExportButton();
  requestAnimationFrame(drawFrame);
})();
