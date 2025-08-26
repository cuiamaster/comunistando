// scripts/translator.mjs
// Traduz texto para pt-BR com múltiplos fallbacks.
// Ordem: LT_ENDPOINT (secreto) → espelhos LibreTranslate → MyMemory → original.
// Com DEBUG_TRANSLATOR=1, loga [TRAD_OK] / [TRAD_ERR] / [TRAD_MM_OK] / [TRAD_FALLBACK_ORIGINAL].

const LT_ENDPOINTS = [
  process.env.LT_ENDPOINT,                          // seu endpoint privado (Secrets)
  'https://libretranslate.de/translate',            // espelho público
  'https://libretranslate.com/translate',           // oficial (pode rate-limitar)
  'https://translate.argosopentech.com/translate'   // espelho público
].filter(Boolean);

const USER_AGENT = 'ComunistandoBot/1.0 (+https://github.com/cuiamaster/comunistando)';

// ======================= utils =======================
function chunkHard(str, size = 4000) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}

// Quebra “suave” para MyMemory (limite menor) tentando em espaços
function chunkSoft(str, size = 450) {
  const out = [];
  let s = (str || '').toString();
  while (s.length > size) {
    let cut = s.lastIndexOf(' ', size);
    if (cut < size * 0.6) cut = size; // se não achar espaço “perto”, corta seco
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s) out.push(s);
  return out;
}

function norm(s){ return (s || '').toString().trim().replace(/\s+/g,' '); }
function changed(a, b){ return norm(a) !== norm(b); }

// ======================= LibreTranslate =======================
async function postLibreTranslate(endpoint, q, { source = 'auto', target = 'pt', apiKey }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({
      q,
      source,
      target,
      format: 'text',
      api_key: apiKey || undefined
    })
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${bodyText.slice(0, 160)}`);
  }

  let data;
  try { data = JSON.parse(bodyText); }
  catch { throw new Error(`JSON inválido: ${bodyText.slice(0, 160)}`); }

  const out = data?.translatedText || (Array.isArray(data) ? data[0]?.translatedText : '');
  if (!out) throw new Error('Sem translatedText na resposta');
  return out;
}

async function tryLibreTranslate(text, { source='auto', target='pt' }={}) {
  const blocks = chunkHard(text, 4000);
  const apiKey = process.env.LT_API_KEY || undefined;
  const result = [];

  for (const block of blocks) {
    let translated = null, used = null, lastErr = null;
    for (const ep of LT_ENDPOINTS.length ? LT_ENDPOINTS : ['https://libretranslate.de/translate']) {
      try {
        const t = await postLibreTranslate(ep, block, { source, target, apiKey });
        translated = t;
        used = ep;
        if (process.env.DEBUG_TRANSLATOR) {
          console.log(`[TRAD_OK] LT ${ep} => "${block.slice(0,40)}" -> "${t.slice(0,40)}"`);
        }
        break;
      } catch (e) {
        lastErr = e;
        if (process.env.DEBUG_TRANSLATOR) console.warn(`[TRAD_ERR] LT ${ep}: ${e.message}`);
      }
    }
    if (translated === null) {
      // todos falharam; propaga último erro pra subir fallback MyMemory
      throw lastErr || new Error('LT sem resposta');
    }
    result.push(translated);
  }
  return result.join('');
}

// ======================= MyMemory fallback =======================
// Doc rápida: https://mymemory.translated.net/doc/spec.php
async function myMemoryOne(q, { source='auto', target='pt' } = {}) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', q);
  url.searchParams.set('langpair', `${source}|${target}`);
  // opcional: url.searchParams.set('de', 'seu-email@dominio.com');

  const res = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });
  const bodyText = await res.text();
  let data;
  try { data = JSON.parse(bodyText); }
  catch { throw new Error(`MyMemory JSON inválido: ${bodyText.slice(0,160)}`); }

  const best = data?.responseData?.translatedText || '';
  if (!best) throw new Error(`MyMemory sem resposta útil: ${bodyText.slice(0,160)}`);
  return best;
}

async function tryMyMemory(text, { source='auto', target='pt' } = {}) {
  const blocks = chunkSoft(text, 450); // limites menores
  const out = [];
  for (const b of blocks) {
    try {
      const t = await myMemoryOne(b, { source, target });
      if (process.env.DEBUG_TRANSLATOR) {
        console.log(`[TRAD_MM_OK] "${b.slice(0,40)}" -> "${t.slice(0,40)}"`);
      }
      out.push(t);
    } catch (e) {
      if (process.env.DEBUG_TRANSLATOR) console.warn(`[TRAD_ERR] MyMemory: ${e.message}`);
      out.push(b); // mantém original deste pedacinho
    }
    // pequena pausa para não irritar o serviço gratuito
    await new Promise(r => setTimeout(r, 120));
  }
  return out.join('');
}

// ======================= API principal =======================
// Traduz um único texto (string) para pt-BR
export async function translate(text, { target='pt', source='auto' } = {}) {
  try {
    if (!text || !text.trim()) return '';

    // 1) Tenta LibreTranslate (auto)
    try {
      const t = await tryLibreTranslate(text, { source, target });
      if (changed(t, text)) return t;
    } catch {}

    // 2) Se parecer inglês, força EN no LT
    const looksEN = /\b(the|and|of|to|in|for|with|on|from|by)\b/i.test(text);
    if (looksEN) {
      try {
        const t2 = await tryLibreTranslate(text, { source: 'en', target });
        if (changed(t2, text)) return t2;
      } catch {}
    }

    // 3) Fallback MyMemory (auto)
    try {
      const mm = await tryMyMemory(text, { source: 'auto', target });
      if (changed(mm, text)) return mm;
    } catch {}

    // 4) Fallback MyMemory (forçando EN se parecer inglês)
    if (looksEN) {
      try {
        const mm2 = await tryMyMemory(text, { source: 'en', target });
        if (changed(mm2, text)) return mm2;
      } catch {}
    }

    if (process.env.DEBUG_TRANSLATOR) {
      console.warn('[TRAD_FALLBACK_ORIGINAL] Sem tradução confiável; mantendo original.');
    }
    return text; // último recurso
  } catch (e) {
    console.warn('Falha na tradução, usando original:', e.message);
    return text;
  }
}

// Traduz HTML simples de parágrafos (<p>...</p>) preservando tags
export async function translateHtmlParagraphs(html) {
  try {
    const pieces = (html || '')
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim()); // tira a tag <p> de abertura

    if (!pieces.length) return html;

    const joined = pieces.join('\n\n');
    const t = await translate(joined, { target: 'pt' });
    const back = (t || '').split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);

    // reempacota em <p>...</p> escapando HTML
    const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
  } catch {
    return html;
  }
}

// (Opcional) Traduz várias strings, de forma serial (evita rate-limit)
export async function translateMany(arr, opts = {}) {
  const results = [];
  for (const s of (arr || [])) {
    results.push(await translate(s, opts));
  }
  return results;
}
