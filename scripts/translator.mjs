// scripts/translator.mjs
// Traduz para pt-BR usando LibreTranslate compatível.
// Tenta nesta ordem: LT_ENDPOINT (seu Secret) -> libretranslate.com -> translate.argosopentech.com -> libretranslate.de
// Se todos falharem, devolve o texto original (fallback).

const PUBLIC_ENDPOINTS = [
  'https://libretranslate.com/translate',
  'https://translate.argosopentech.com/translate',
  'https://libretranslate.de/translate'
];

// Divide textos longos
function chunk(str, size = 4500) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}

async function callLT(endpoint, q, { source = 'auto', target = 'pt', apiKey }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, source, target, format: 'text', api_key: apiKey || undefined })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.translatedText || '';
}

export async function translate(text, { target = 'pt', source = 'auto' } = {}) {
  try {
    if (!text) return '';
    const apiKey = process.env.LT_API_KEY || undefined;
    const endpoints = [];
    if (process.env.LT_ENDPOINT) endpoints.push(process.env.LT_ENDPOINT);
    endpoints.push(...PUBLIC_ENDPOINTS);

    const blocks = chunk(text, 4500);
    const out = [];

    for (const q of blocks) {
      let done = false;
      for (const ep of endpoints) {
        try {
          const t = await callLT(ep, q, { source, target, apiKey });
          out.push(t || q);
          done = true;
          break;
        } catch (e) {
          console.warn('Falha endpoint', ep, e.message);
        }
      }
      if (!done) out.push(q); // nenhum endpoint respondeu
    }
    return out.join('');
  } catch (e) {
    console.warn('Falha na tradução, usando original:', e.message);
    return text;
  }
}

// Traduz HTML simples de parágrafos (<p>...</p>) preservando tags
export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!parts.length) return html;

    const joined = parts.join('\n\n');
    const t = await translate(joined, { target: 'pt' });
    const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);

    return back.map(seg =>
      `<p>${seg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
    ).join('\n');
  } catch {
    return html;
  }
}
