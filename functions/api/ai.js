// Cloudflare Pages Function: POST /api/ai  (generic Gemini proxy, keeps the API key on the server)
// Settings (Cloudflare project, Variables and secrets): GEMINI_API_KEY (secret), GEMINI_MODEL, GEMINI_FALLBACK_MODEL (optional), SYSTEM_PROMPT (optional)
//
// Request JSON:  { prompt: string, image?: base64 jpeg (no data: prefix), system?: string, json?: boolean }
// Response 200:  { text: string }   or, when json is true,  { data: object }
// Response error: { error: string }  (lists what happened with each model)

const DEFAULT_SYSTEM = 'You are a helpful assistant inside a small web app. Be concise and accurate.';

export async function onRequestPost({ request, env }) {
  const key = env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: 'GEMINI_API_KEY is not set in Cloudflare.' });

  let body;
  try { body = await request.json(); } catch (e) { return reply(400, { error: 'Bad request.' }); }
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 8000) return reply(400, { error: 'Send a prompt (up to 8000 characters).' });
  if (body.image && (typeof body.image !== 'string' || body.image.length > 3000000)) return reply(400, { error: 'Image is too large.' });

  const parts = [];
  if (body.image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: body.image } });
  parts.push({ text: body.prompt });
  const system = (typeof body.system === 'string' && body.system) || env.SYSTEM_PROMPT || DEFAULT_SYSTEM;
  const wantJson = body.json === true;

  const models = [env.GEMINI_MODEL || 'gemini-3.5-flash-lite', env.GEMINI_FALLBACK_MODEL]
    .filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
  const queue = models.length > 1 ? models : [models[0], models[0]];
  const deadline = Date.now() + 28000;
  const notes = [];

  for (let i = 0; i < queue.length; i++) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${queue[i]}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(i < queue.length - 1 ? Math.min(left, 14000) : left),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts }],
          generationConfig: wantJson ? { responseMimeType: 'application/json', temperature: 0.3 } : { temperature: 0.7 }
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (data.error && data.error.message) || 'request failed';
        console.error('Gemini error', queue[i], res.status, msg);
        notes.push(queue[i] + ' (' + res.status + '): ' + String(msg).slice(0, 90));
        if (res.status === 429 || res.status === 503 || res.status === 500) { await sleep(700); continue; } // busy: try next model
        break;
      }
      const cand = data.candidates && data.candidates[0];
      const text = cand && cand.content && cand.content.parts
        ? cand.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('') : '';
      if (!text) { notes.push(queue[i] + ': no text' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '')); continue; }
      if (!wantJson) return reply(200, { text });
      return reply(200, { data: JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) });
    } catch (e) {
      console.error('ai failed', queue[i], e && e.name, e && e.message);
      notes.push(queue[i] + ': ' + (e && e.name === 'TimeoutError' ? 'no answer in time' : String((e && e.message) || e).slice(0, 100)));
    }
  }
  return reply(502, { error: notes.join(' | ') || 'Gemini is busy. Try again in a moment.' });
}

export async function onRequest() { return reply(405, { error: 'Use POST.' }); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function reply(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
