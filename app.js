// --- State Management ---
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;

// Separate Z-Index ranges for layering
let highestMediaZIndex = 1;         // Range: 1 - 999 (Images & Videos)
let highestForegroundZIndex = 1000; // Range: 1000+ (Text & Audio)

let isShiftPressed = false;
let isSpacePressed = false;

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

// Selection & Lasso State
let selectedTiles = new Set();
let isLassoing = false;
let lassoStartX = 0;
let lassoStartY = 0;

// MediaRecorder & Mic Stream State
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;

// DOM Elements
const viewport = document.getElementById('viewport');
const world = document.getElementById('canvas-world');
const tilesContainer = document.getElementById('tiles-container');
const recIndicator = document.getElementById('recording-indicator');
const selectionBox = document.getElementById('selection-box');

const hudTitleBtn = document.getElementById('hud-title-btn');
const themeDropdown = document.getElementById('theme-dropdown');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const patternOptions = document.querySelectorAll('.theme-option[data-pattern]');

let currentPattern = 'dots';
viewport.classList.add(`pattern-${currentPattern}`);

// Click "Spatial Canvas" title to toggle dropdown
hudTitleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  themeDropdown.classList.toggle('hidden');
  hudTitleBtn.classList.toggle('active');
});

// Close menu when clicking anywhere outside
window.addEventListener('click', (e) => {
  if (!themeDropdown.contains(e.target) && e.target !== hudTitleBtn) {
    themeDropdown.classList.add('hidden');
    hudTitleBtn.classList.remove('active');
  }
});

function createCustomAudioPlayer(parentContainer, audioSrc) {
  const voiceTile = document.createElement('div');
  voiceTile.className = 'voice-tile';

  const audioEl = document.createElement('audio');
  audioEl.src = audioSrc;
  // Mark custom attribute for clear querying during saveSpace()
  audioEl.setAttribute('data-persistent-src', audioSrc);

  const vizContainer = document.createElement('div');
  vizContainer.className = 'visualizer-container';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'play-circle-btn';
  playBtn.textContent = '▶';

  const canvas = document.createElement('canvas');
  canvas.className = 'audio-viz-canvas';
  canvas.height = 40;
  const ctx = canvas.getContext('2d');

  vizContainer.appendChild(playBtn);
  vizContainer.appendChild(canvas);
  voiceTile.appendChild(audioEl);
  voiceTile.appendChild(vizContainer);
  parentContainer.appendChild(voiceTile);

  let audioCtx, analyser, source, dataArray;
  let isInitialized = false;
  let animationId;
  let phase = 0;

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isInitialized = true;
  }

  function updateCanvasWidth() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      canvas.width = rect.width;
    }
  }

  requestAnimationFrame(updateCanvasWidth);

  function drawSineWave(color, amp, freq, ph) {
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    for (let x = 0; x < width; x += 0.2) {
      let scaling = Math.sin((x / width) * Math.PI);
      let y = centerY + Math.sin((x * freq * 0.05) + ph) * amp * scaling;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function renderWave() {
    animationId = requestAnimationFrame(renderWave);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    let average = sum / dataArray.length;
    let amplitude = (average / 255) * 15;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    phase += 0.1;

    drawSineWave('#5ac8fa', amplitude, 1, phase);
    drawSineWave('#5856d6', amplitude * 0.8, 1.5, phase * 1.2);
    drawSineWave('#ff2d55', amplitude * 0.5, 2, phase * 0.8);
  }

  playBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (!isInitialized) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (audioEl.paused) {
      audioEl.play();
      playBtn.textContent = '❚❚';
      vizContainer.classList.add('is-playing');
      renderWave();
    } else {
      audioEl.pause();
      playBtn.textContent = '▶';
      vizContainer.classList.remove('is-playing');
      cancelAnimationFrame(animationId);
    }
  });

  audioEl.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    vizContainer.classList.remove('is-playing');
    cancelAnimationFrame(animationId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

// Toggle Dark Mode
darkModeToggle.addEventListener('change', (e) => {
  e.stopPropagation();
  if (darkModeToggle.checked) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  saveSpace();
});

// Switch pattern classes on #viewport
patternOptions.forEach(option => {
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    const selectedPattern = option.dataset.pattern;

    viewport.classList.remove(`pattern-${currentPattern}`);
    viewport.classList.add(`pattern-${selectedPattern}`);
    currentPattern = selectedPattern;

    patternOptions.forEach(opt => opt.classList.remove('active'));
    option.classList.add('active');

    themeDropdown.classList.add('hidden');
    hudTitleBtn.classList.remove('active');
    saveSpace();
  });
});

// --- Navigation (Pan & Zoom) ---

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;

  if (currentPattern === 'waves') {
    const waveBaseSize = 100; 
    const scaledWaveSize = waveBaseSize * scale;

    const waveOffsetX = panX % scaledWaveSize;
    const waveOffsetY = panY % scaledWaveSize;

    viewport.style.backgroundPosition = `${waveOffsetX}px ${waveOffsetY}px`;
    viewport.style.backgroundSize = `${scaledWaveSize}px ${scaledWaveSize}px`;
    return;
  }

  viewport.style.backgroundPosition = `${panX}px ${panY}px`;
  viewport.style.backgroundSize = `${24 * scale}px ${24 * scale}px`;
}

function screenToCanvas(screenX, screenY) {
  return {
    x: (screenX - panX) / scale,
    y: (screenY - panY) / scale
  };
}

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  if (isPanning) {
    panX += e.clientX - startX;
    panY += e.clientY - startY;
    startX = e.clientX;
    startY = e.clientY;
    updateTransform();
    return;
  }

  if (isLassoing) {
    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(lassoStartX, currentX);
    const top = Math.min(lassoStartY, currentY);
    const width = Math.abs(currentX - lassoStartX);
    const height = Math.abs(currentY - lassoStartY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;

    const boxRect = selectionBox.getBoundingClientRect();

    document.querySelectorAll('.tile').forEach(tile => {
      const tileRect = tile.getBoundingClientRect();
      if (isIntersecting(boxRect, tileRect)) {
        tile.classList.add('selected');
        selectedTiles.add(tile);
      } else {
        tile.classList.remove('selected');
        selectedTiles.delete(tile);
      }
    });
  }
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = 1.08;
  let newScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;

  newScale = Math.min(Math.max(0.2, newScale), 4);

  panX = mouseX - (mouseX - panX) * (newScale / scale);
  panY = mouseY - (mouseY - panY) * (newScale / scale);
  scale = newScale;

  updateTransform();
}, { passive: false });

// --- Lasso & Selection Logic ---

function clearSelection() {
  selectedTiles.forEach(tile => tile.classList.remove('selected'));
  selectedTiles.clear();
}

function isIntersecting(r1, r2) {
  return !(r2.left > r1.right || 
           r2.right < r1.left || 
           r2.top > r1.bottom || 
           r2.bottom < r1.top);
}

viewport.addEventListener('mousedown', (e) => {
  if (isShiftPressed || e.button === 1) {
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    viewport.classList.add('panning');
    return;
  }

  if (e.target === viewport || e.target === world) {
    clearSelection();
    isLassoing = true;
    lassoStartX = e.clientX;
    lassoStartY = e.clientY;

    selectionBox.style.left = `${lassoStartX}px`;
    selectionBox.style.top = `${lassoStartY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
  }
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    if (!isShiftPressed) viewport.classList.remove('panning');
  }

  if (isLassoing) {
    isLassoing = false;
    selectionBox.style.display = 'none';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    isShiftPressed = true;
    viewport.classList.add('panning');
  }

  if (e.code === 'Space' && !isSpacePressed) {
    if (document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      isSpacePressed = true;
      startAudioRecording();
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
      selectedTiles.forEach(tile => tile.remove());
      selectedTiles.clear();
      saveSpace();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    isShiftPressed = false;
    if (!isPanning) viewport.classList.remove('panning');
  }

  if (e.code === 'Space' && isSpacePressed) {
    isSpacePressed = false;
    stopAudioRecording();
  }
});

// --- Persistence (Save & Load System) ---

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function saveSpace() {
  const tileElements = document.querySelectorAll('.tile');
  const tilesData = [];

  tileElements.forEach(tileEl => {
    const tileType = tileEl.dataset.tileType || 'foreground';
    const x = parseFloat(tileEl.style.left) || 0;
    const y = parseFloat(tileEl.style.top) || 0;
    const zIndex = parseInt(tileEl.style.zIndex, 10) || 1;

    // In saveSpace():
    const textarea = tileEl.querySelector('textarea');
    if (textarea) {
      tilesData.push({
        type: 'text',
        tileType,
        x,
        y,
        zIndex,
        width: parseFloat(tileEl.style.width) || null,
        height: parseFloat(tileEl.style.height) || null,
        text: textarea.value
      });
      return;
    }

    // 2. Media Tile Checks
    const img = tileEl.querySelector('img');
    const video = tileEl.querySelector('video');
    const audio = tileEl.querySelector('audio');
    const labelEl = tileEl.querySelector('.media-filename');
    const fileName = labelEl ? labelEl.textContent : '';

    if (img && img.src) {
      tilesData.push({
        type: 'image',
        tileType,
        x,
        y,
        zIndex,
        width: parseFloat(tileEl.dataset.width) || parseFloat(tileEl.style.width) || tileEl.offsetWidth,
        src: img.src,
        fileName
      });
    } else if (video && video.src) {
      tilesData.push({
        type: 'video',
        tileType,
        x,
        y,
        zIndex,
        width: parseFloat(tileEl.dataset.width) || parseFloat(tileEl.style.width) || tileEl.offsetWidth,
        src: video.src,
        fileName
      });
    } else if (audio) {
      const audioSrc = audio.getAttribute('data-persistent-src') || audio.src;
      if (audioSrc) {
        tilesData.push({
          type: 'audio',
          tileType,
          x,
          y,
          zIndex,
          width: parseFloat(tileEl.dataset.width) || parseFloat(tileEl.style.width) || tileEl.offsetWidth,
          src: audioSrc,
          fileName
        });
      }
    }
  });

  const spaceData = {
    version: 1,
    lastModified: Date.now(),
    pattern: typeof currentPattern !== 'undefined' ? currentPattern : 'dots',
    darkMode: document.body.classList.contains('dark-mode'),
    tiles: tilesData
  };

  try {
    localStorage.setItem('spatial_canvas_data', JSON.stringify(spaceData));
  } catch (e) {
    console.error('Storage quota exceeded or save error:', e);
  }
}

function loadSpace() {
  const savedData = localStorage.getItem('spatial_canvas_data');
  if (!savedData) return;

  try {
    const spaceData = JSON.parse(savedData);

    // 1. Restore Theme & Dark Mode
    if (spaceData.darkMode) {
      document.body.classList.add('dark-mode');
      if (darkModeToggle) darkModeToggle.checked = true;
    } else {
      document.body.classList.remove('dark-mode');
      if (darkModeToggle) darkModeToggle.checked = false;
    }

    // 2. Restore Pattern UI
    if (spaceData.pattern) {
      viewport.classList.remove(`pattern-${currentPattern}`);
      viewport.classList.add(`pattern-${spaceData.pattern}`);
      currentPattern = spaceData.pattern;

      patternOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.pattern === currentPattern);
      });
    }

    // 3. Clear Workspace
    tilesContainer.innerHTML = '';
    clearSelection();

    highestMediaZIndex = 1;
    highestForegroundZIndex = 1000;

    // 4. Rebuild Workspace Tiles
    if (Array.isArray(spaceData.tiles)) {
      spaceData.tiles.forEach(tileData => {
        const tile = createTileElement(tileData.x ?? 0, tileData.y ?? 0, tileData.tileType || 'foreground');

        if (tileData.zIndex) {
          tile.style.zIndex = tileData.zIndex;
          if (tileData.tileType === 'media') {
            highestMediaZIndex = Math.max(highestMediaZIndex, tileData.zIndex);
          } else {
            highestForegroundZIndex = Math.max(highestForegroundZIndex, tileData.zIndex);
          }
        }

        // Reconstruct Text Tile
        // In loadSpace(), under text tile reconstruction:
        if (tileData.type === 'text') {
          if (tileData.width) tile.style.width = `${tileData.width}px`;
          if (tileData.height) tile.style.height = `${tileData.height}px`;

          const textarea = document.createElement('textarea');
          textarea.className = 'tile-text-input';
          textarea.value = tileData.text || '';

          textarea.addEventListener('input', () => {
            saveSpace();
          });

          textarea.addEventListener('blur', () => {
            textarea.classList.remove('editing');
            saveSpace();
          });

          tile.appendChild(textarea);
          attachTileResizeHandle(tile, 'text');
        }
        
        // Reconstruct Media Tiles
        else if (['image', 'video', 'audio'].includes(tileData.type)) {
          if (tileData.width) {
            tile.style.width = `${tileData.width}px`;
            tile.dataset.width = tileData.width;
          }

          const container = document.createElement('div');
          container.className = 'tile-media-container';

          if (tileData.type === 'image' && tileData.src) {
            const img = document.createElement('img');
            img.src = tileData.src;
            img.addEventListener('dragstart', (e) => e.preventDefault());
            container.appendChild(img);
          } else if (tileData.type === 'video' && tileData.src) {
            const video = document.createElement('video');
            video.src = tileData.src;
            video.controls = true;
            container.appendChild(video);
          } else if (tileData.type === 'audio' && tileData.src) {
            createCustomAudioPlayer(container, tileData.src);
          }

          if (tileData.fileName) {
            const nameTag = document.createElement('div');
            nameTag.className = 'media-filename';
            nameTag.textContent = tileData.fileName;
            container.appendChild(nameTag);
          }

          tile.appendChild(container);
          attachTileResizeHandle(tile);
        }
      });
    }

    // Sync localStorage once after full DOM restoration
    saveSpace();
  } catch (err) {
    console.error('Failed to load canvas space:', err);
  }
}

// --- Tile Generator ---

function createTileElement(canvasX, canvasY, tileType = 'foreground') {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.tileType = tileType;
  tile.style.left = `${canvasX}px`;
  tile.style.top = `${canvasY}px`;

  if (tileType === 'media') {
    tile.style.zIndex = ++highestMediaZIndex;
  } else {
    tile.style.zIndex = ++highestForegroundZIndex;
  }

  // Delete Button
  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'tile-delete';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>`;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tile.remove();
    selectedTiles.delete(tile);
    saveSpace();
  });
  tile.appendChild(deleteBtn);

  // Dragging Anywhere on the Tile
  tile.addEventListener('mousedown', (e) => {
    if (isShiftPressed || e.button === 1) return;
    if (e.target === deleteBtn || e.target.classList.contains('tile-resize-handle') || e.target.classList.contains('interactive') || e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') return;
    const textarea = tile.querySelector('.tile-text-input');
    if (textarea && textarea.classList.contains('editing')) return;

    e.stopPropagation();

    if (!selectedTiles.has(tile) && !e.metaKey && !e.ctrlKey) {
      clearSelection();
      tile.classList.add('selected');
      selectedTiles.add(tile);
    }

    if (tile.dataset.tileType === 'media') {
      tile.style.zIndex = ++highestMediaZIndex;
    } else {
      tile.style.zIndex = ++highestForegroundZIndex;
    }

    let dragStartX = e.clientX;
    let dragStartY = e.clientY;

    const onMouseMove = (moveEvent) => {
      const dx = (moveEvent.clientX - dragStartX) / scale;
      const dy = (moveEvent.clientY - dragStartY) / scale;

      selectedTiles.forEach(selectedTile => {
        selectedTile.style.left = `${parseFloat(selectedTile.style.left) + dx}px`;
        selectedTile.style.top = `${parseFloat(selectedTile.style.top) + dy}px`;
      });

      dragStartX = moveEvent.clientX;
      dragStartY = moveEvent.clientY;
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      saveSpace();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  tile.addEventListener('dblclick', (e) => {
    const textarea = tile.querySelector('.tile-text-input');
    if (textarea) {
      e.stopPropagation();
      textarea.classList.add('editing');
      textarea.focus();
    }
    e.stopPropagation(); // Prevents creating a text tile when double-clicking a media tile
    const video = tile.querySelector('video');
    if (video) {
      e.stopPropagation(); // Prevents text creation or canvas double-click triggers
      video.classList.add('interactive');
      video.focus();
    }
    window.addEventListener('mousedown', (e) => {
      document.querySelectorAll('video.interactive').forEach(video => {
        if (!video.contains(e.target)) {
          video.classList.remove('interactive');
        }
      });
    });
  });

  tilesContainer.appendChild(tile);
  return tile;
}

// --- Text Tile Generation ---

viewport.addEventListener('dblclick', (e) => {
  if (e.target !== viewport && e.target !== world) return;

  const pos = screenToCanvas(e.clientX, e.clientY);
  const tile = createTileElement(pos.x, pos.y, 'foreground');

  tile.style.width = '200px';

  const textarea = document.createElement('textarea');
  textarea.className = 'tile-text-input editing';
  textarea.placeholder = 'Type something...';

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    saveSpace();
  });

  textarea.addEventListener('blur', () => {
    textarea.classList.remove('editing');
    saveSpace();
  });

  tile.appendChild(textarea);
  attachTileResizeHandle(tile, 'text');
  setTimeout(() => textarea.focus(), 50);
});

// --- File Handling & Unified Drag/Drop ---

viewport.addEventListener('dragover', (e) => e.preventDefault());

viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;

  const pos = screenToCanvas(e.clientX, e.clientY);

  files.forEach((file, index) => {
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      importSpaceFromFile(file);
    } else {
      const offsetPos = { x: pos.x + index * 20, y: pos.y + index * 20 };
      handleFileDrop(file, offsetPos);
    }
  });
});

function handleFileDrop(file, pos) {
  const isVisualMedia = file.type.startsWith('image/') || file.type.startsWith('video/');
  const isAudioMedia = file.type.startsWith('audio/');
  const tileType = (isVisualMedia || isAudioMedia) ? 'media' : 'foreground';

  const reader = new FileReader();

  reader.onload = (e) => {
    const fileURL = e.target.result;
    const tile = createTileElement(pos.x, pos.y, tileType);
    const container = document.createElement('div');
    container.className = 'tile-media-container';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.addEventListener('dragstart', (ev) => ev.preventDefault());

      img.onload = () => {
        const width = Math.min(320, img.naturalWidth * 0.5);
        tile.style.width = `${width + 28}px`;
        saveSpace();
      };

      img.src = fileURL;
      container.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.controls = true;

      video.onloadedmetadata = () => {
        const width = Math.min(360, video.videoWidth * 0.5);
        tile.style.width = `${width + 28}px`;
        saveSpace();
      };

      video.src = fileURL;
      container.appendChild(video);
    } else if (file.type.startsWith('audio/')) {
      tile.style.width = '240px';
      createCustomAudioPlayer(container, fileURL);
    } else {
      const label = document.createElement('div');
      label.style.padding = '8px';
      label.style.fontSize = '13px';
      label.textContent = `📄 ${file.name}`;
      container.appendChild(label);
    }

    const nameTag = document.createElement('div');
    nameTag.className = 'media-filename';
    nameTag.textContent = file.name;
    container.appendChild(nameTag);

    tile.appendChild(container);
    const type =  file.type.startsWith('image/') ? 'image' : 
                  file.type.startsWith('video/') ? 'video' : 
                  file.type.startsWith('audio/') ? 'audio' : 'text';
    attachTileResizeHandle(tile, type);

    saveSpace();
  };

  reader.readAsDataURL(file);
}

// --- Voice Note Stream & Spacebar Recording ---

async function initMicrophone() {
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Microphone access was denied or unassigned on launch.');
      return false;
    }
  }
  return true;
}

async function startAudioRecording() {
  const hasMic = await initMicrophone();
  if (!hasMic) {
    isSpacePressed = false;
    return;
  }

  audioChunks = [];

  try {
    mediaRecorder = new MediaRecorder(micStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = await blobToBase64(audioBlob);

      const pos = screenToCanvas(mouseX, mouseY);
      const tile = createTileElement(pos.x, pos.y, 'foreground');
      tile.style.width = '240px';

      const container = document.createElement('div');
      container.className = 'tile-media-container';

      createCustomAudioPlayer(container, audioUrl);

      const label = document.createElement('div');
      label.className = 'media-filename';
      label.textContent = `🎤 Voice Note (${new Date().toLocaleTimeString()})`;

      container.appendChild(label);
      tile.appendChild(container);
      attachTileResizeHandle(tile, 'audio');
      saveSpace();
    };

    mediaRecorder.start();
    recIndicator.classList.add('active');
  } catch (err) {
    console.error('Error starting MediaRecorder:', err);
    isSpacePressed = false;
  }
}

function stopAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  recIndicator.classList.remove('active');
}

// --- Import / Export System ---

const exportBtn = document.getElementById('export-btn');

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    saveSpace();
    const data = localStorage.getItem('spatial_canvas_data');
    if (!data) {
      alert('No data to export!');
      return;
    }

    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `SpatialCanvas-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

function importSpaceFromFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const jsonText = e.target.result;
      const parsedData = JSON.parse(jsonText);
      if (!parsedData.tiles || !Array.isArray(parsedData.tiles)) {
        throw new Error('Invalid file structure.');
      }

      localStorage.setItem('spatial_canvas_data', jsonText);
      loadSpace();
    } catch (err) {
      alert('Failed to import file. Make sure it is a valid spatial canvas JSON file.');
      console.error(err);
    }
  };

  reader.readAsText(file);
}

// Restore saved space and microphone access on load
window.addEventListener('DOMContentLoaded', () => {
  initMicrophone();
  loadSpace();
  saveSpace();
});s

function attachTileResizeHandle(tile, type) {
  // -------------------------------------------------------------
  // 1. Audio Tiles: Horizontal-Only Scaling (Right Edge Handle)
  // -------------------------------------------------------------
  if (type === 'audio') {
    const handle = document.createElement('div');
    handle.className = 'tile-resize-handle';
    tile.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startWidth = tile.offsetWidth;
      const canvas = tile.querySelector('canvas');

      const onMouseMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / scale;
        const newWidth = Math.max(200, startWidth + dx);

        tile.style.width = `${newWidth}px`;
        tile.style.height = 'auto';
        tile.dataset.width = newWidth;

        if (canvas) {
          canvas.width = canvas.getBoundingClientRect().width;
        }
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        saveSpace();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
    return;
  }

  // -------------------------------------------------------------
  // 2. Text Tiles: 2D Corner Scaling + Dynamic Minimum Size
  // -------------------------------------------------------------
  if (type === 'text') {
    const cornerHandle = document.createElement('div');
    cornerHandle.className = 'tile-resize-handle-corner';
    tile.appendChild(cornerHandle);

    cornerHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const textarea = tile.querySelector('textarea');
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = tile.offsetWidth;
      const startHeight = tile.offsetHeight;

      // Measure minimum required height dynamically based on current content & width
      textarea.style.height = 'auto';
      const minDynamicHeight = Math.max(60, textarea.scrollHeight + 28);
      textarea.style.height = '100%';

      const onMouseMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;

        const newWidth = Math.max(140, startWidth + dx);
        const newHeight = Math.max(minDynamicHeight, startHeight + dy);

        tile.style.width = `${newWidth}px`;
        tile.style.height = `${newHeight}px`;
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        saveSpace();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
    return;
  }

  // -------------------------------------------------------------
  // 3. Image & Video Tiles: Aspect Ratio Scaling (Corner Handle)
  // -------------------------------------------------------------
  if (type === 'image' || type === 'video') {
    const cornerHandle = document.createElement('div');
    cornerHandle.className = 'tile-resize-handle-corner';
    tile.appendChild(cornerHandle);

    cornerHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startWidth = tile.offsetWidth;
      const aspectRatio = tile.offsetWidth / tile.offsetHeight;

      const onMouseMove = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / scale;
        const newWidth = Math.max(120, startWidth + dx);
        const newHeight = newWidth / aspectRatio;

        tile.style.width = `${newWidth}px`;
        tile.style.height = `${newHeight}px`;
        tile.dataset.width = newWidth;
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        saveSpace();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }
}