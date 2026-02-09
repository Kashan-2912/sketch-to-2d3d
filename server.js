require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

const API_KEY = process.env.NVAPI_KEY;
const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// System prompts for different generation modes
const SYSTEM_PROMPTS = {
  '3d': `You are a Three.js 3D scene code generator. Given a description, output ONLY valid JavaScript code.

STRICT RULES:
- The variable "scene" already exists. Add objects to it with scene.add(mesh).
- Use THREE.BoxGeometry, THREE.SphereGeometry, THREE.CylinderGeometry, THREE.ConeGeometry, THREE.TorusGeometry, THREE.TorusKnotGeometry, THREE.PlaneGeometry, THREE.RingGeometry, THREE.DodecahedronGeometry, THREE.IcosahedronGeometry, THREE.OctahedronGeometry.
- Use THREE.MeshStandardMaterial({ color: 0xHEXCOLOR, roughness: 0.5, metalness: 0.3 }) for materials.
- Create meshes: const mesh = new THREE.Mesh(geometry, material);
- Position: mesh.position.set(x, y, z); Rotation: mesh.rotation.set(x, y, z); Scale: mesh.scale.set(x, y, z);
- You can use THREE.Group() to group objects.
- Add a grid: scene.add(new THREE.GridHelper(20, 20, 0x444466, 0x222244));
- Keep coordinates in range -10 to 10. Ground plane at y=0.
- Use loops and Math functions for patterns.
- DO NOT set up scene, camera, renderer, lights, or controls. They exist already.
- DO NOT use import/export statements.
- DO NOT wrap code in markdown code blocks or backticks.
- Output raw JavaScript code only. No explanations, no comments before code.
- Start with actual code immediately on the first line.`,

  'interpret': `You are a creative art interpreter. Given drawing stroke data as arrays of coordinates, describe what the drawing looks like. Be imaginative, vivid, and fun. Suggest what 3D scene could be generated from it. Keep response under 200 words.`,

  'svg': `You are an SVG art generator. Create beautiful, creative SVG artwork. Output ONLY valid SVG markup.

RULES:
- Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
- Use vibrant gradients, patterns, and creative shapes.
- Make it visually stunning with layered elements.
- End with </svg>
- No markdown, no explanations, no code blocks. Only raw SVG.`,

  'default': 'You are a helpful creative AI assistant specialized in art and 3D design.'
};

// AI Generation endpoint - uses native fetch to stream from NVIDIA API
app.post('/api/generate', async (req, res) => {
  const { prompt, mode } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS['default'];

  console.log(`[${new Date().toLocaleTimeString()}] Generating (mode=${mode})`);

  try {
    // Use native fetch for reliable streaming
    const apiRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 1,
        top_p: 1,
        max_tokens: 4096,
        stream: true
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('API Error:', apiRes.status, errText);
      return res.status(apiRes.status).json({
        error: apiRes.status === 429
          ? 'Rate limit hit. Wait a moment and try again.'
          : `API error (${apiRes.status})`,
        details: errText
      });
    }

    // Set SSE headers and flush
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Pipe the NVIDIA SSE stream directly to the client
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();

    let aborted = false;
    req.on('close', () => { aborted = true; });

    while (true) {
      const { done, value } = await reader.read();
      if (done || aborted) break;
      const text = decoder.decode(value, { stream: true });
      res.write(text);
    }

    if (!aborted) {
      res.end();
    }

    console.log(`[${new Date().toLocaleTimeString()}] Generation complete`);

  } catch (error) {
    console.error('Server Error:', error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'AI generation failed',
        details: error.message
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: 'openai/gpt-oss-120b' });
});

app.listen(PORT, () => {
  console.log(`\n  SketchForge AI is running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Model:   openai/gpt-oss-120b (NVIDIA NIM)\n`);
});
