// Cloudflare Pages Function: POST /api/analyze  (receipt photo -> amount, merchant, category)
// Settings (Cloudflare project, Variables and secrets): GEMINI_API_KEY (secret), GEMINI_MODEL (optional), GEMINI_FALLBACK_MODEL (optional)
//
// Request JSON:  { image: base64 jpeg (no data: prefix), mime?: string, defaultCurrency?: string }
// Response 200:  { amount: number, currency: string, merchant: string, category: string, confidence: number }
// Response error: { error: string }  (lists what happened with each model)

const CATEGORIES = ['Food & Beverage', 'Transport', 'Shopping', 'Groceries', 'Entertainment', 'Bills', 'Health', 'Other'];

const SYSTEM = 'You read photos of receipts, bills, price tags and payment slips and extract the amount the person paid. ' +
  'Return ONLY a JSON object with these keys: amount (number, the final total paid, no currency symbol), ' +
  'currency (3-letter ISO code such as THB, TWD, USD; if unclear use the default currency given), ' +
  'merchant (shop or item name, short), category (exactly one of: ' + CATEGORIES.join(', ') + '), ' +
  'confidence (number from 0 to 1). If you cannot find an amount, set amount to null and confidence to 0.';

export async function onRequestPost({ request, env }) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) return reply(500, { error: 'GEMINI_API_KEY is not set in Cloudflare.' });

  let body;
  try { body = await request.json(); } catch (e) { return reply(400, { error: 'Bad request.' }); }
  if (typeof body.image !== 'string' || !body.image || body.image.length > 3000000) return reply(400, { error: 'Send a photo (jpeg, base64, under about 2 MB).' });
  const def = String(body.defaultCurrency || 'THB').toUpperCase().slice(0, 3);

  const parts = [
    { inline_data: { mime_type: body.mime === 'image/png' ? 'image/png' : 'image/jpeg', data: body.image } },
    { text: 'Default currency: ' + def + '. Extract the amount paid from this photo.' }
  ];

  const models = [env.GEMINI_MODEL || 'gemini-3.5-flash-lite', env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash']
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
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
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
      if (!text) { notes.push(queue[i] + ': no text'); continue; }
      let o;
      try { o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
      catch (e) { notes.push(queue[i] + ': unreadable answer'); continue; }
      const amount = Number(o.amount);
      return reply(200, {
        amount: isFinite(amount) && amount > 0 ? amount : null,
        currency: /^[A-Za-z]{3}$/.test(o.currency || '') ? String(o.currency).toUpperCase() : def,
        merchant: String(o.merchant || '').slice(0, 80),
        category: CATEGORIES.includes(o.category) ? o.category : 'Other',
        confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0))
      });
    } catch (e) {
      console.error('analyze failed', queue[i], e && e.name, e && e.message);
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
