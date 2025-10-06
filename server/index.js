// ===========================================
// File: server/index.js  (ESM, full drop-in)
// ===========================================
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT      = Number(process.env.PORT) || 8787;
const BUILD_DIR = path.join(__dirname, '..', 'build');

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env')
];

for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---- OpenAI client ----
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY,
});

// ---- Voice/model guards for /api/tts ----
const ALLOWED_VOICES = ['nova','shimmer','echo','onyx','fable','alloy','ash','sage','coral'];
const ALLOWED_MODELS = ['tts-1','tts-1-hd','gpt-4o-mini-tts'];
const sanitizeVoice  = v => (ALLOWED_VOICES.includes(String(v||'').toLowerCase()) ? v : 'alloy');
const sanitizeModel  = m => (ALLOWED_MODELS.includes(String(m||'').toLowerCase()) ? m : 'tts-1');

// ---- Health ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: fs.existsSync(BUILD_DIR) ? 'ui+api' : 'api-only', ttsVoices: ALLOWED_VOICES });
});

// ---- Tone (OpenAI-independent) ----
app.get('/api/tone', (_req, res) => {
  const sr = 44100, secs = 1, f = 880, n = Math.floor(sr * secs);
  const header = 44, bps = 2, dataSize = n * bps;
  const buf = Buffer.alloc(header + dataSize);
  buf.write('RIFF',0); buf.writeUInt32LE(36+dataSize,4); buf.write('WAVE',8);
  buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20);
  buf.writeUInt16LE(1,22); buf.writeUInt32LE(sr,24); buf.writeUInt32LE(sr*bps,28);
  buf.writeUInt16LE(bps,32); buf.writeUInt16LE(16,34); buf.write('data',36);
  buf.writeUInt32LE(dataSize,40);
  for (let i=0;i<n;i++){const t=i/sr, env=Math.min(1,i/400,(n-i)/400);const s=Math.sin(2*Math.PI*f*t)*env*0.8;buf.writeInt16LE((s*32767)|0, header+i*2);}
  res.set('Content-Type','audio/wav'); res.send(buf);
});

// ---- TTS ----
app.post('/api/tts', async (req, res) => {
  try {
    if (!openai.apiKey) return res.status(400).json({ error: 'OpenAI key missing' });
    const text = (req.body?.text ?? '').toString();
    if (!text.trim()) return res.status(400).json({ error: 'text required' });
    const requestedVoice = (req.body?.voice ?? 'alloy').toString();
    const requestedModel = (req.body?.model ?? 'tts-1').toString();
    const finalVoice = sanitizeVoice(requestedVoice.toLowerCase());
    const finalModel = sanitizeModel(requestedModel.toLowerCase());
    const voiceCoerced = finalVoice !== requestedVoice.toLowerCase();
    const modelCoerced = finalModel !== requestedModel.toLowerCase();

    const resp = await openai.audio.speech.create({ model: finalModel, voice: finalVoice, input: text });
    const ab   = await resp.arrayBuffer();
    const buf  = Buffer.from(ab);

    res.set('Content-Type','audio/mpeg');
    res.set('x-voice-requested', requestedVoice);
    res.set('x-voice-final', finalVoice);
    res.set('x-voice-coerced', voiceCoerced ? '1':'0');
    res.set('x-model-requested', requestedModel);
    res.set('x-model-final', finalModel);
    res.set('x-model-coerced', modelCoerced ? '1':'0');
    res.status(200).send(buf);
  } catch (err) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    console.error('[api/tts] error:', detail);
    res.status(400).json({ error:'OpenAI TTS failed', detail });
  }
});

// ---- NEW: /api/chat  (fixes “Chat request failed”) ----
// expects: { model, messages, temperature }
// returns: { choices:[{ message:{ content } }]}
app.post('/api/chat', async (req, res) => {
  try {
    if (!openai.apiKey) return res.status(400).json({ error: 'OpenAI key missing' });
    const model = (req.body?.model ?? 'gpt-4o-mini').toString();
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const temperature = Number(req.body?.temperature ?? 0.6);
    if (!messages.length) return res.status(400).json({ error: 'messages required' });

    const out = await openai.chat.completions.create({ model, messages, temperature });
    // Match the client shape it expects:
    res.json({ choices: [{ message: { content: out.choices?.[0]?.message?.content ?? '' } }] });
  } catch (err) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    console.error('[api/chat] error:', detail);
    res.status(400).json({ error:'chat failed', detail });
  }
});

// ---- NEW: /api/pinyin  (used by ensurePinyinFromServer) ----
// expects: { text, model }  -> { pinyin }
app.post('/api/pinyin', async (req, res) => {
  try {
    if (!openai.apiKey) return res.status(400).json({ pinyin: '' });
    const text = (req.body?.text ?? '').toString().trim();
    if (!text) return res.json({ pinyin: '' });

    const sys = 'You convert Mandarin Chinese Hanzi into Hanyu Pinyin with tone marks. Return ONLY the pinyin, no extra text.';
    const out = await openai.chat.completions.create({
      model: (req.body?.model ?? 'gpt-4o-mini').toString(),
      temperature: 0,
      messages: [{ role:'system', content: sys }, { role:'user', content: text }]
    });
    const pinyin = (out.choices?.[0]?.message?.content ?? '').trim();
    res.json({ pinyin });
  } catch (err) {
    console.error('[api/pinyin] error', err?.message || err);
    res.json({ pinyin: '' });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({
    chatModel: 'gpt-4o-mini',
    sttModel: 'gpt-4o-mini-transcribe',
    ttsModel: 'tts-1',
    realtimeModel: 'gpt-4o-mini-realtime-preview'
  });
});


let serverInstance;
let uiConfigured = false;

const configureUiRoutes = (serveUi) => {
  if (uiConfigured) return;
  uiConfigured = true;
  const hasBuild = fs.existsSync(BUILD_DIR);
  if (hasBuild && serveUi) {
    app.use(express.static(BUILD_DIR));
    app.get('*', (_req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        `Huayu Buddy API running.\nMode: ${hasBuild ? 'ui+api' : 'api-only'} @ ${BUILD_DIR}\nUse CRA in dev or npm run build for prod.`
      );
    });
  }
};

export const createServer = async (options = {}) => {
  if (serverInstance) return serverInstance;

  const {
    port = PORT,
    serveUi = process.env.SERVE_UI !== 'false',
    quiet = false
  } = options;

  configureUiRoutes(serveUi);

  serverInstance = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => {
      if (!quiet) {
        console.log(`[server] listening on http://localhost:${port}`);
        console.log(`[server] UI mode: ${fs.existsSync(BUILD_DIR) && serveUi ? 'ui+api' : 'api-only'}`);
      }
      resolve(listener);
    });
    listener.on('error', (err) => {
      serverInstance = undefined;
      reject(err);
    });
    listener.on('close', () => {
      serverInstance = undefined;
    });
  });

  return serverInstance;
};

const isDirectRun = (() => {
  try {
    return pathToFileURL(process.argv[1] || '').href === import.meta.url;
  } catch (err) {
    return false;
  }
})();

if (isDirectRun) {
  createServer().catch((err) => {
    console.error('[server] failed to start', err);
    process.exitCode = 1;
  });
}

export default createServer;
export { app };

