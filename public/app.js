/* ============================================
   SketchForge AI - Application Logic
   ============================================ */

// ==========================================
//  GLOBAL STATE
// ==========================================
let canvas, ctx;
let isDrawing = false;
let strokes = [];
let currentStroke = [];
let strokeHistory = []; // for undo
let activeTool = 'pen';
let currentColor = '#e2e8f0';
let lineWidth = 3;

let scene, camera, renderer, controls;
let gridHelper = null;
let showGrid = true;
let wireframeMode = false;
let isGenerating = false;
let abortController = null;
let elapsedTimer = null;

// Nice color palette for extruded shapes
const EXTRUDE_COLORS = [
  0x7c3aed, 0x06b6d4, 0xf59e0b, 0xef4444, 0x10b981,
  0xec4899, 0x8b5cf6, 0x14b8a6, 0xf97316, 0x6366f1
];

// ==========================================
//  CANVAS / SKETCH PAD
// ==========================================
function initCanvas() {
  canvas = document.getElementById('sketchCanvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();

  // Mouse events
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('mouseleave', onPointerUp);

  // Touch events
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onPointerUp);

  window.addEventListener('resize', () => {
    resizeCanvas();
    redrawStrokes();
  });
}

function resizeCanvas() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  // Use slightly smaller than container
  canvas.width = Math.floor(rect.width - 20);
  canvas.height = Math.floor(rect.height - 20);
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function onPointerDown(e) {
  isDrawing = true;
  const pos = getCanvasPos(e);
  currentStroke = [pos];
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function onPointerMove(e) {
  if (!isDrawing) return;
  const pos = getCanvasPos(e);
  currentStroke.push(pos);

  if (activeTool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = lineWidth * 4;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = lineWidth;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function onPointerUp() {
  if (!isDrawing) return;
  isDrawing = false;

  if (currentStroke.length > 1) {
    strokes.push({
      points: [...currentStroke],
      color: activeTool === 'eraser' ? null : currentColor,
      width: activeTool === 'eraser' ? lineWidth * 4 : lineWidth,
      tool: activeTool
    });
    strokeHistory.push([...strokes]);
  }
  currentStroke = [];
}

function onTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  onPointerDown({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  onPointerMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function redrawStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.width;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes = [];
  strokeHistory = [];
}

function undoStroke() {
  if (strokes.length === 0) return;
  strokes.pop();
  redrawStrokes();
}

function getStrokeData() {
  return strokes
    .filter(s => s.tool === 'pen')
    .map(s => s.points.map(p => [Math.round(p.x), Math.round(p.y)]));
}

// ==========================================
//  THREE.JS VIEWER
// ==========================================
function initThreeJS() {
  const container = document.getElementById('threeContainer');

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d18);
  scene.fog = new THREE.Fog(0x0d0d18, 30, 60);

  // Camera
  camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(8, 6, 8);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);

  // Lights
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
  directionalLight.position.set(8, 12, 6);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -15;
  directionalLight.shadow.camera.right = 15;
  directionalLight.shadow.camera.top = 15;
  directionalLight.shadow.camera.bottom = -15;
  scene.add(directionalLight);

  const fillLight = new THREE.DirectionalLight(0x7c3aed, 0.3);
  fillLight.position.set(-5, 3, -5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x06b6d4, 0.2);
  rimLight.position.set(0, -3, 8);
  scene.add(rimLight);

  // Ground plane
  const groundGeom = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x111122,
    roughness: 0.95,
    metalness: 0.05
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  ground.name = '__ground__';
  scene.add(ground);

  // Grid
  gridHelper = new THREE.GridHelper(20, 20, 0x333355, 0x1a1a33);
  gridHelper.name = '__grid__';
  scene.add(gridHelper);

  // Handle resize
  window.addEventListener('resize', onThreeResize);

  // Animate
  animate();
}

function onThreeResize() {
  const container = document.getElementById('threeContainer');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function clearScene() {
  const toRemove = [];
  scene.traverse(child => {
    if (child.isMesh && !child.name.startsWith('__')) {
      toRemove.push(child);
    }
    if (child.isGridHelper && child.name !== '__grid__') {
      toRemove.push(child);
    }
    if (child.isGroup) {
      toRemove.push(child);
    }
  });
  toRemove.forEach(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
    scene.remove(obj);
  });
  document.getElementById('threeOverlay').classList.remove('hidden');
}

function resetCamera() {
  camera.position.set(8, 6, 8);
  controls.target.set(0, 0, 0);
  controls.update();
}

function toggleGrid() {
  showGrid = !showGrid;
  if (gridHelper) gridHelper.visible = showGrid;
}

function toggleWireframe() {
  wireframeMode = !wireframeMode;
  scene.traverse(child => {
    if (child.isMesh && !child.name.startsWith('__')) {
      if (child.material) {
        child.material.wireframe = wireframeMode;
      }
    }
  });
}

function executeThreeCode(code) {
  clearScene();
  document.getElementById('threeOverlay').classList.add('hidden');

  try {
    // Create a safe execution context
    const fn = new Function('scene', 'THREE', code);
    fn(scene, THREE);

    // Enable shadows on all new meshes
    scene.traverse(child => {
      if (child.isMesh && !child.name.startsWith('__')) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (wireframeMode && child.material) {
          child.material.wireframe = true;
        }
      }
    });

    // Auto-frame the scene
    autoFrameScene();
    return true;
  } catch (error) {
    console.error('Three.js code execution error:', error);
    showResponse(`Error executing 3D code: ${error.message}`, 'error');
    return false;
  }
}

function autoFrameScene() {
  const box = new THREE.Box3();
  let hasObjects = false;

  scene.traverse(child => {
    if (child.isMesh && !child.name.startsWith('__')) {
      box.expandByObject(child);
      hasObjects = true;
    }
  });

  if (!hasObjects) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.8;

  camera.position.set(
    center.x + distance * 0.7,
    center.y + distance * 0.5,
    center.z + distance * 0.7
  );
  controls.target.copy(center);
  controls.update();
}

// ==========================================
//  EXTRUDE 2D TO 3D
// ==========================================
function extrudeDrawing() {
  const penStrokes = strokes.filter(s => s.tool === 'pen' && s.points.length > 2);

  if (penStrokes.length === 0) {
    showResponse('Draw something on the canvas first, then click Extrude!', 'error');
    return;
  }

  clearScene();
  document.getElementById('threeOverlay').classList.add('hidden');

  const canvasW = canvas.width;
  const canvasH = canvas.height;
  const scale = 60; // pixels per Three.js unit

  penStrokes.forEach((stroke, idx) => {
    const points = simplifyStroke(stroke.points, 3);
    if (points.length < 3) return;

    // Convert canvas coords to Three.js coords
    const shapePoints = points.map(p => new THREE.Vector2(
      (p.x - canvasW / 2) / scale,
      -(p.y - canvasH / 2) / scale
    ));

    // Create shape
    const shape = new THREE.Shape();
    shape.moveTo(shapePoints[0].x, shapePoints[0].y);
    for (let i = 1; i < shapePoints.length; i++) {
      shape.lineTo(shapePoints[i].x, shapePoints[i].y);
    }
    shape.closePath();

    // Extrude settings
    const extrudeSettings = {
      depth: 0.5 + Math.random() * 1.5,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 3
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const color = EXTRUDE_COLORS[idx % EXTRUDE_COLORS.length];
    const material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.4,
      metalness: 0.3,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Lay flat on ground
    mesh.position.y = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  autoFrameScene();
  showResponse(`Extruded ${penStrokes.length} stroke(s) into 3D shapes! Orbit the camera to explore.`, 'success');
}

function simplifyStroke(points, tolerance) {
  if (points.length <= 2) return points;

  // Douglas-Peucker simplification
  const sqDist = (p1, p2) => (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
  const sqDistToSegment = (p, v, w) => {
    const l2 = sqDist(v, w);
    if (l2 === 0) return sqDist(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return sqDist(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
  };

  function simplify(pts, sqTol) {
    if (pts.length <= 2) return pts;
    let maxDist = 0, maxIdx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = sqDistToSegment(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > sqTol) {
      const left = simplify(pts.slice(0, maxIdx + 1), sqTol);
      const right = simplify(pts.slice(maxIdx), sqTol);
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  }

  return simplify(points, tolerance * tolerance);
}

// ==========================================
//  AI CLIENT
// ==========================================
async function generateAI(prompt, mode) {
  if (isGenerating) return;
  isGenerating = true;

  const btnGenerate = document.getElementById('btnGenerate');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const responseContent = document.getElementById('responseContent');
  const thinkingBox = document.getElementById('thinkingBox');
  const thinkingContent = document.getElementById('thinkingContent');
  const btnToggleThinking = document.getElementById('btnToggleThinking');
  const btnCopyResponse = document.getElementById('btnCopyResponse');
  const responseLabel = document.getElementById('responseLabel');

  // Reset UI
  btnGenerate.disabled = true;
  document.body.classList.add('generating');
  loadingOverlay.style.display = 'flex';
  responseContent.className = 'response-content streaming';
  responseContent.textContent = '';
  thinkingBox.style.display = 'none';
  thinkingContent.textContent = '';
  btnToggleThinking.style.display = 'none';
  btnCopyResponse.style.display = 'none';
  responseLabel.textContent = 'Generating...';

  // Elapsed time counter
  let elapsed = 0;
  const elapsedEl = document.getElementById('elapsedTime');
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    elapsed++;
    if (elapsedEl) elapsedEl.textContent = elapsed + 's';
  }, 1000);

  // Abort controller for cancellation
  abortController = new AbortController();

  let fullContent = '';
  let thinkingText = '';

  try {
    const thinking = document.getElementById('thinkingMode')?.checked || false;
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode, thinking }),
      signal: abortController.signal
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'API request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.reasoning_content) {
            thinkingText += delta.reasoning_content;
            thinkingContent.textContent = thinkingText;
            if (thinkingText.length > 0) {
              btnToggleThinking.style.display = 'inline-block';
            }
          }

          if (delta?.content) {
            fullContent += delta.content;
            // Show truncated preview
            const preview = fullContent.length > 500
              ? fullContent.substring(0, 500) + '...'
              : fullContent;
            responseContent.textContent = preview;
          }
        } catch (parseErr) {
          // Skip invalid JSON chunks
        }
      }
    }

    // Generation complete
    cleanupGeneration();
    responseLabel.textContent = 'AI Response';

    if (fullContent.length > 0) {
      btnCopyResponse.style.display = 'inline-block';
    }

    // Handle result based on mode
    handleGenerationResult(fullContent, mode);

  } catch (error) {
    cleanupGeneration();

    if (error.name === 'AbortError') {
      responseLabel.textContent = 'Cancelled';
      showResponse('Generation cancelled.', '');
    } else {
      console.error('Generation error:', error);
      responseLabel.textContent = 'Error';

      let msg = error.message || 'Unknown error';
      if (msg.includes('timeout') || msg.includes('timed out')) {
        msg = 'Request timed out. The AI took too long. Try a simpler prompt.';
      } else if (msg.includes('Rate limit') || msg.includes('429')) {
        msg = 'Rate limit reached (40 RPM). Wait a few seconds and try again.';
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        msg = 'Network error. Check your internet connection and that the server is running.';
      }
      showResponse(msg, 'error');
    }
  }

  isGenerating = false;
}

function cleanupGeneration() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  abortController = null;
  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('btnGenerate').disabled = false;
  document.body.classList.remove('generating');
}

function handleGenerationResult(content, mode) {
  if (!content || content.trim().length === 0) {
    showResponse('AI returned empty response. Try a different prompt.', 'error');
    return;
  }

  switch (mode) {
    case '3d':
      handleThreeJSResult(content);
      break;
    case 'svg':
      handleSVGResult(content);
      break;
    case 'interpret':
      showResponse(content, 'success');
      break;
    default:
      showResponse(content, '');
      break;
  }
}

function handleThreeJSResult(content) {
  // Extract code - remove markdown code blocks if present
  let code = content;

  // Remove ```javascript ... ``` or ```js ... ``` blocks
  const codeBlockMatch = code.match(/```(?:javascript|js)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1];
  }

  // Remove any leading/trailing whitespace
  code = code.trim();

  // Remove any leading explanatory text before actual code
  const firstCodeLine = code.search(/(?:const|let|var|scene\.|new |\/\/|for\s*\(|function)/);
  if (firstCodeLine > 0) {
    code = code.substring(firstCodeLine);
  }

  const success = executeThreeCode(code);
  if (success) {
    showResponse('3D scene generated successfully! Use mouse to orbit, scroll to zoom.', 'success');
  }
}

function handleSVGResult(content) {
  // Extract SVG
  let svg = content;
  const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    svg = svgMatch[0];
  }

  const svgOutput = document.getElementById('svgOutput');
  svgOutput.innerHTML = svg;

  const svgModal = document.getElementById('svgModal');
  svgModal.classList.add('visible');

  showResponse('SVG art generated! Check the popup.', 'success');
}

// ==========================================
//  UI HELPERS
// ==========================================
function showResponse(text, type) {
  const el = document.getElementById('responseContent');
  el.textContent = text;
  el.className = 'response-content' + (type ? ' ' + type : '');
}

// ==========================================
//  UI INITIALIZATION
// ==========================================
function initUI() {
  // View mode buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector('.main-content').dataset.view = btn.dataset.view;
      // Trigger resize for Three.js
      setTimeout(() => {
        onThreeResize();
        resizeCanvas();
        redrawStrokes();
      }, 50);
    });
  });

  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTool = btn.dataset.tool;
      canvas.style.cursor = activeTool === 'eraser' ? 'cell' : 'crosshair';
    });
  });

  // Color picker
  document.getElementById('colorPicker').addEventListener('input', (e) => {
    currentColor = e.target.value;
  });

  // Line width slider
  const slider = document.getElementById('lineWidth');
  const sizeLabel = document.getElementById('sizeLabel');
  slider.addEventListener('input', (e) => {
    lineWidth = parseInt(e.target.value);
    sizeLabel.textContent = lineWidth;
  });

  // Canvas buttons
  document.getElementById('btnUndo').addEventListener('click', undoStroke);
  document.getElementById('btnClearCanvas').addEventListener('click', clearCanvas);

  // 3D buttons
  document.getElementById('btnResetCamera').addEventListener('click', resetCamera);
  document.getElementById('btnToggleGrid').addEventListener('click', () => {
    toggleGrid();
    document.getElementById('btnToggleGrid').classList.toggle('active');
  });
  document.getElementById('btnToggleWireframe').addEventListener('click', () => {
    toggleWireframe();
    document.getElementById('btnToggleWireframe').classList.toggle('active');
  });
  document.getElementById('btnClear3D').addEventListener('click', clearScene);

  // Header buttons
  document.getElementById('btnExtrude').addEventListener('click', extrudeDrawing);
  document.getElementById('btnClearAll').addEventListener('click', () => {
    clearCanvas();
    clearScene();
    showResponse('Everything cleared. Start fresh!', '');
  });

  // Generation
  const promptInput = document.getElementById('promptInput');
  const btnGenerate = document.getElementById('btnGenerate');

  btnGenerate.addEventListener('click', handleGenerate);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  });

  // Quick prompts
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      promptInput.value = btn.dataset.prompt;
      document.getElementById('genMode').value = btn.dataset.mode;
      handleGenerate();
    });
  });

  // SVG modal close
  document.getElementById('btnCloseSvg').addEventListener('click', () => {
    document.getElementById('svgModal').classList.remove('visible');
  });

  // Thinking toggle
  document.getElementById('btnToggleThinking').addEventListener('click', () => {
    const box = document.getElementById('thinkingBox');
    const btn = document.getElementById('btnToggleThinking');
    if (box.style.display === 'none') {
      box.style.display = 'block';
      btn.textContent = 'Hide Thinking';
    } else {
      box.style.display = 'none';
      btn.textContent = 'Show Thinking';
    }
  });

  // Cancel button
  document.getElementById('btnCancel').addEventListener('click', () => {
    if (abortController) {
      abortController.abort();
    }
  });

  // Copy response
  document.getElementById('btnCopyResponse').addEventListener('click', () => {
    const text = document.getElementById('responseContent').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btnCopyResponse');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  });

  // Resize handle for panels
  initResizeHandle();
}

function handleGenerate() {
  const prompt = document.getElementById('promptInput').value.trim();
  const mode = document.getElementById('genMode').value;

  if (mode === 'interpret') {
    // Get stroke data instead of text prompt
    const strokeData = getStrokeData();
    if (strokeData.length === 0) {
      showResponse('Draw something on the canvas first for the AI to interpret!', 'error');
      return;
    }
    const desc = `Here is drawing stroke data (arrays of [x,y] coordinates). Each array is one stroke:\n${JSON.stringify(strokeData)}\n\nCanvas size: ${canvas.width}x${canvas.height}. Describe what this drawing looks like and suggest a 3D scene that could be generated from it.`;
    generateAI(desc, mode);
  } else {
    if (!prompt) {
      showResponse('Enter a prompt describing what you want to generate!', 'error');
      document.getElementById('promptInput').focus();
      return;
    }
    generateAI(prompt, mode);
  }
}

// ==========================================
//  PANEL RESIZE
// ==========================================
function initResizeHandle() {
  const handle = document.getElementById('resizeHandle');
  const canvasPanel = document.getElementById('canvasPanel');
  const threePanel = document.getElementById('threePanel');
  let isDragging = false;
  let startX = 0;
  let startCanvasWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startCanvasWidth = canvasPanel.getBoundingClientRect().width;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const mainWidth = document.querySelector('.main-content').getBoundingClientRect().width;
    const newWidth = Math.max(200, Math.min(mainWidth - 200, startCanvasWidth + dx));
    const ratio = newWidth / mainWidth;
    canvasPanel.style.flex = `0 0 ${newWidth}px`;
    threePanel.style.flex = '1';

    // Resize canvas and Three.js
    setTimeout(() => {
      resizeCanvas();
      redrawStrokes();
      onThreeResize();
    }, 0);
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ==========================================
//  INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initThreeJS();
  initUI();

  // Set initial view
  document.querySelector('.main-content').dataset.view = 'split';

  console.log('%c SketchForge AI ', 'background: linear-gradient(135deg, #7c3aed, #06b6d4); color: white; font-size: 16px; font-weight: bold; padding: 8px 16px; border-radius: 4px;');
  console.log('Ready! Draw on the canvas or enter a prompt to generate 3D scenes.');
});
