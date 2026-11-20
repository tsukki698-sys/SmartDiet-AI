async function callAI(parts: unknown[], maxTokens = 1200): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  const models = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL].filter(Boolean) as string[];
  if (!key || !models.length) throw new Error('GEMINI_API_KEY or GEMINI_MODEL is not set');

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
  });
  let lastStatus = 0;

modelLoop: for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        console.error(`Gemini ${model} did not answer:`, (e as Error).name);
        lastStatus = 503;
        break; // try the next model
      }
      if (res.ok) {
        const data: any = await res.json();
        return (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
      }
      lastStatus = res.status;
      const details = await res.text();
      console.error(`Gemini ${model} error ${res.status}:`, details.slice(0, 300));
      const busy = res.status === 503 || res.status === 429;
      if (res.status === 429) break modelLoop;
      if (!busy) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (lastStatus === 429) throw new Error('AI limit reached. Please try again in a minute.');
  if (lastStatus === 503) throw new Error('The AI is busy right now. Please try again in a moment.');
  throw new Error(`AI request failed (${lastStatus})`);
}

// Pull the JSON object out of the model's reply
const parseJson = (t: string) => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));

/**
 * Meal explanations. The AI only rewords reasons for meals that ALREADY passed
 * the rule filter. If the AI fails, plain-text reasons are used instead.
 */
export async function explain(
  items: { key: string; meal: string; reasons: string[] }[]
): Promise<Record<string, string>> {
  const fallback = Object.fromEntries(
    items.map(i => [i.key, `Recommended because it ${i.reasons.join(', ') || 'fits your profile'}.`])
  );
  try {
    const text = await callAI(
      [{ text: `Rewrite each meal's reasons as one friendly sentence (max 30 words). Use ONLY the given facts; do not add health claims or new nutrition numbers. Return JSON {"<key>": "sentence"}.\n${JSON.stringify(items)}` }],
      8000
    );
    const out = parseJson(text);
    const clean = Object.fromEntries(
      Object.entries(out).filter(([k, v]) => k in fallback && typeof v === 'string')
    ) as Record<string, string>;
    return { ...fallback, ...clean };
  } catch (e) {
    console.error('AI explain failed:', e);
    return fallback;
  }
}

export interface FoodItem {
  name: string;
  grams: number;
  calories: number;
  confidence: 'low' | 'medium' | 'high';
}

/** Photo -> likely foods, portions and calories. Always a rough estimate. */
export async function estimateFromPhoto(dataUrl: string): Promise<{ items: FoodItem[]; notes: string }> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('Unsupported image. Use a JPEG, PNG or WebP photo.');

  const text = await callAI(
    [
      { inline_data: { mime_type: m[1], data: m[2] } },
      { text: 'Identify the likely foods in this meal photo. For each food, estimate ONE serving that a single person would eat from what is visible, in grams and calories. If the food is in a pot, tray or large shared dish, estimate one typical bowl or plate portion, not the whole dish, and say so in notes. These are rough visual estimates. If it is not food, return an empty list. Return only JSON: {"items":[{"name":string,"grams":number,"calories":number,"confidence":"low|medium|high"}],"notes":string}' },
    ],
    4000
  );

  const o = parseJson(text);
  const clamp = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const items: FoodItem[] = (Array.isArray(o.items) ? o.items : []).slice(0, 12).map((i: any) => ({
    name: String(i.name || 'Unknown food').slice(0, 80),
    grams: clamp(i.grams, 2000),
    calories: clamp(i.calories, 3000),
    confidence: ['low', 'medium', 'high'].includes(i.confidence) ? i.confidence : 'low',
  }));
  return { items, notes: String(o.notes || '').slice(0, 300) };
}