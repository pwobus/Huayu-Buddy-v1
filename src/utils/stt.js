// File: src/utils/stt.js  (FULL FILE)
// Transcribe audio Blob by posting to our server Whisper route.
export async function transcribeBlobToText(blob, { language = 'zh' } = {}) {
  const buf = await blob.arrayBuffer();
  // base64 encode
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);

  const resp = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64: b64, mime: blob.type || 'audio/webm', language }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`STT server error ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json().catch(() => ({}));
  return (data?.text || '').trim();
}
