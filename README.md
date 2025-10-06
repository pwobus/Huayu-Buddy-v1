
# Huayu Buddy — Chinese Conversation Tutor

A Mandarin conversation web app with:
- Spoken tutor replies (OpenAI TTS) and optional browser TTS fallback
- Head-only 3D avatar with viseme-based lip-sync + blinking
- Pinyin + Hanzi display, optional English translation
- HSK 1 - HSK 5 vocabulary and review table
- Health checks & diagnostics

---
On Ubuntu machine:

sudo apt update
sudo apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

Install Google Chrome (or Chromium with TTS voices):

wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb

git clone https://github.com/pwobus/Huayu-Buddy.git
cd Huayu-Buddy
echo "REACT_APP_OPENAI_API_KEY=sk-..." > .env
npm install
npm start

2) Environment

OPENAI_API_KEY (required, server): your OpenAI key.

PORT (optional, server): API port (default 8787).

SERVE_UI=false (optional, server): force API-only even if ./build exists.

3) Server Endpoints

All responses are JSON unless noted.

GET /api/health → { ok, mode, ttsVoices }

GET /api/tone → WAV beep (useful to verify audio path without OpenAI)

POST /api/tts → MP3 bytes
Body: { text, voice?, model?, lang? }
Headers: x-voice-* and x-model-* indicate if server coerced invalid values.

POST /api/chat → { choices: [{ message: { content } }] }
Body: { model, messages, temperature }

POST /api/pinyin → { pinyin }
Body: { text, model }

GET /api/config → basic client config (model names, etc.)


cURL smoke tests
# Health
curl -s http://localhost:8787/api/health | jq

# Tone (should download ~1s WAV)
curl -s -o tone.wav http://localhost:8787/api/tone && afplay tone.wav  # mac
# Linux: aplay tone.wav (or play with any audio player)

# TTS (gets MP3 bytes)
curl -s -X POST http://localhost:8787/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"ni hao","voice":"alloy","model":"tts-1"}' \
  -o out.mp3 && ( command -v mpg123 && mpg123 out.mp3 )
  
  4) OpenAI Models / Voices (safe defaults)

Chat: gpt-4o-mini (fast, inexpensive)
Alt: gpt-4o, o4-mini, or gpt-4.1-mini if you prefer.

TTS: tts-1 or tts-1-hd

TTS voices (supported): alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer

If the client sends an invalid voice, server coerces to alloy.

5) Avatar (GLB) Notes

Place your file at: /public/head-avatar.glb

⚙️ — set custom mouth/blink morph names (persisted)

6) UI “First-Aid” Checklist
A) No sound

Click Enable Audio (browser autoplay policies).

Visit /api/tone or press ▶ Tone (server) in Health card — must hear a beep.

Press Test en / Test zh.

If silent but /api/tts returns 200 with bytes: browser playback issue; app auto-falls back to <audio>. Reload tab.

If 400: check server log; voice may be invalid → server will switch to alloy. Confirm headers (x-voice-coerced: 1).

Linux/Chromium often reports 0 voices → rely on OpenAI TTS instead of browser TTS.

B) “Chat request failed”

Server must be running with OPENAI_API_KEY.

/api/chat must return JSON shape { choices: [{ message: { content } }] }.

Check DevTools Network tab, Response & Console for errors.

C) Avatar not visible / wrong framing

Open http://localhost:3000/head-avatar.glb → should download.

D) Zero browser voices

Chromium on some Linux builds returns 0 voices (normal).

Use OpenAI TTS (server) → ensure /api/tts works.

E) Pinyin column blank

The server’s /api/pinyin is used as a fallback.

Requires API key; check server logs if it returns empty.

F) 404 on /api/*

Ensure root package.json has "proxy": "http://localhost:8787" in dev.

Confirm server is running on the expected port.

G) ESM/CommonJS errors on server

Server uses ESM ("type":"module").

Run with node server/index.js.

If you prefer CJS, rename to index.cjs and remove "type":"module".

7) Health & Diagnostics

HealthCard shows:

API reachable

/api/tts returns bytes

GLB accessible

Browser voice count

It also includes ▶ Tone (server) to validate audio output.

8) Keyboard & UX Tips

Keep OpenAI TTS enabled on systems with no browser voices.

9) Common Config Edits

Change default chat/TTS models: edit /server/index.js and /api/config route.

Force server to API-only in dev: set SERVE_UI=false.

Persist different defaults in localStorage keys:

hb_morph_mouth, hb_morph_blinkL, hb_morph_blinkR


## 1) Quick Start

### Dev (recommended)
Frontend (:3000) + API server (:8787)

```bash
# Terminal A — API server
cd server
npm i
OPENAI_API_KEY=sk-... npm run dev

# Terminal B — frontend
npm install
npm start

Ensure your root package.json contains:

{ "proxy": "http://localhost:8787" }

## 2) Electron Desktop Build

Package the React UI and Express API into a single Electron application (no external Node server required).

### Prerequisites

```bash
npm install
```

### Run the desktop app in development

This launches the CRA dev server (:3000), the API server (:8787), and an Electron shell that points at the dev UI.

```bash
npm run electron:dev
```

### Create a portable Windows .exe (no installer)

Build the production React bundle, embed it in Electron, and emit a single portable executable under `dist/`:

```bash
npm run electron:build
```

Result: `dist/HuayuBuddy-<version>-portable.exe`

- Runs offline with the bundled Express API + React UI.
- No console window.
- Users can double-click the `.exe` directly; no installer required.

> Tip: place an `.env` file alongside the executable (or set system environment variables) so the bundled server can read `OPENAI_API_KEY`.

