// scripts/translator.mjs
// Traduz para pt-BR com fallback: LibreTranslate (vários endpoints) -> MyMemory.
// Usa LT_ENDPOINT/LT_API_KEY se definidos em Secrets. Se tudo falhar, devolve o original.

const LT_DEFAULTS = [
  'https://translate.astian.org/translate',
  'https://libretranslate.de/translate',
  'https://libretranslate.com/translate'
];

function chunk(str, size = 4500) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callLibreTranslate(endpoint, { q, source = 'auto', target = 'pt', apiKey }) {
  const body = {
    q, source, target, format: 'text',
    ...(apiKey ? { api_key: apiKey } : {})
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${txt.slice(0,120)}`);
  }
  const data = await res.json();
  const out = data?.translatedText ?? data?.translated_text;
  if (typeof out !== 'string') throw new Error('Resposta inesperada do LT');
  return out;
}

async function callMyMemory({ q, source = 'en', target = 'pt-BR' }) {
  // documentação: https://mymemory.translated.net/doc/spec.php
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText;
  if (typeof out !== 'string') throw new Error('Resposta inesperada do MyMemory');
  return out;
}

async function translateWithLT(text, { source = 'auto', target = 'pt' } = {}) {
  const envEndpoint = process.env.LT_ENDPOINT;
  const envApiKey   = process.env.LT_API_KEY || undefined;
  const endpoints = [
    ...(envEndpoint ? [envEndpoint] : []),
    ...LT_DEFAULTS
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const blocks = chunk(text, 4500);
  const out = [];
  for (const q of blocks) {
    let done = false;
    for (const ep of endpoints) {
      try {
        const translated = await callLibreTranslate(ep, { q, source, target, apiKey: envApiKey });
        console.warn(`[translator] OK via LibreTranslate: ${ep}`);
        out.push(translated);
        await sleep(200);
        done = true;
        break;
      } catch (e) {
        console.warn(`[translator] Falha LT ${ep}: ${e.message}`);
      }
    }
    if (!done) throw new Error('Todos LT falharam para um bloco');
  }
  return out.join('');
}

async function translateWithMyMemory(text, { source = 'en', target = 'pt-BR' } = {}) {
  const blocks = chunk(text, 4500);
  const out = [];
  for (const q of blocks) {
    const translated = await callMyMemory({ q, source, target });
    console.warn('[translator] OK via MyMemory');
    out.push(translated);
    await sleep(200);
  }
  return out.join('');
}

// ==== API pública ====
export async function translate(text, { target = 'pt', source = 'auto' } = {}) {
  try {
    // 1) tenta LibreTranslate (com fila de endpoints)
    return await translateWithLT(text, { source, target });
  } catch (_e1) {
    console.warn('[translator] LT indisponível — tentando MyMemory…');
    try {
      // 2) MyMemory pede códigos fixos; se o texto estiver em inglês, source=en funciona bem.
      return await translateWithMyMemory(text, { source: 'en', target: 'pt-BR' });
    } catch (_e2) {
      console.warn('[translator] MyMemory também falhou — devolvendo original.');
      return text;
    }
  }
}

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
  } catch (e) {
    console.warn('translateHtmlParagraphs falhou — devolvendo HTML original:', e.message);
    return html;
  }
}
