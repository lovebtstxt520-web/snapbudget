// Cloudflare Pages Function: POST /api/analyze
// API key 只存在 Cloudflare 環境變數 GEMINI_API_KEY，前端看不到。

const PROMPT = `You are an expense-extraction engine. The image is ONE of: a paper receipt/invoice, a mobile payment success screenshot (Line Pay, PromptPay, TrueMoney, JKOPay, Apple Pay, bank transfer, etc.), a price list/menu, or a photo of food/drink.

Return ONLY a JSON object with these keys:
{
  "amount": number,            // the total actually paid. Receipts: the grand total, not subtotal/cash tendered/change. Payment screenshots: the amount paid/transferred. Price list or food photo: best estimate of the single item price if visible, otherwise 0.
  "currency": string,          // ISO 4217 code (THB, TWD, USD...). Infer from symbols (฿, NT$, $) and language. If unsure use "${"$"}{DEFAULT_CURRENCY}".
  "merchant": string,          // shop / payee name, short. For food photo, name the dish.
  "category": "Food & Beverage" | "Transport" | "Shopping" | "Groceries" | "Entertainment" | "Bills" | "Health" | "Other",
  "date": string | null,       // YYYY-MM-DD if visible
  "source_type": "receipt" | "payment_screenshot" | "price_list" | "food_photo" | "unknown",
  "confidence": number         // 0 to 1. Use <= 0.5 if the amount is estimated or unclear.
}
Rules: numbers use a dot as decimal separator and no thousands separators. Never invent an amount that is not in the image; if there is none, use 0 and confidence 0.2. No markdown, no commentary.`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not set" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const { image, mime = "image/jpeg", defaultCurrency = "THB" } = body || {};
  if (!image || image.length > 6_000_000) return json({ error: "missing or too large image" }, 400);

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT.replace("${DEFAULT_CURRENCY}", defaultCurrency) },
          { inline_data: { mime_type: mime, data: image } }
        ]
      }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    })
  });

  if (!r.ok) return json({ error: "gemini " + r.status, detail: (await r.text()).slice(0, 300) }, 502);

  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  try {
    const out = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
    out.amount = Number(out.amount) || 0;
    return json(out);
  } catch {
    return json({ error: "unparsable model output", raw: text.slice(0, 300) }, 502);
  }
}
