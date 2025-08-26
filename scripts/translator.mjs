// scripts/translator.mjs
// Traduz texto para pt-BR com múltiplos fallbacks.
// Ordem: LibreTranslate (seu endpoint e espelhos) → MyMemory (nunca 'auto') → original.
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
function chunkSoft(str, size = 450) {
  const out = [];
  let s = (str || '').toString();
  while (s.length > size) {
    let cut = s.lastIndexOf(' ', size);
    if (cut < size * 0.6) cut = size;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s) out.push(s);
  return out;
}
function norm(s){ return (s || '').toString().trim().replace(/\s+/g,' '); }
function changed(a, b){ return norm(a) !== norm(b); }

// Heurística simples para adivinhar o idioma de origem (nunca devolve 'auto')
function guessLang(text) {
  const s = (text || '').toString();

  // Scripts
  if (/\p{Script=Han}/u.test(s)) return 'zh-CN';           // chinês
  if (/\p{Script=Cyrillic}/u.test(s)) return 'ru';          // russo
  if (/\p{Script=Arabic}/u.test(s)) return 'ar';
  if (/\p{Script=Hebrew}/u.test(s)) return 'he';
  if (/\p{Script=Hangul}/u.test(s)) return 'ko';
  if (/\p{Script=Devanagari}/u.test(s)) return 'hi';

  // Palavras-função comuns
  const looksEN = /\b(the|and|of|to|in|for|with|on|from|by|is|are|be|was|were)\b/i.test(s);
  if (looksEN) return 'en';

  const looksES = /[ñáéíóúü]|(?:\b(el|la|los|las|de|y|que|en|por|con|para|como)\b)/i.test(s);
  if (looksES) return 'es';

  const looksFR = /[àâçéèêëîïôûùüÿœ]|(?:\b(le|la|les|des|du|et|pour|avec|sur|dans)\b)/i.test(s);
  if (looksFR) return 'fr';

  const looksPT = /[ãõáéíóúç]|(?:\b(que|de|e|em|para|com|por|como)\b)/i.test(s);
  if (looksPT) return 'pt';

  // Padrão: assumimos inglês (boa aproximação para as fontes)
  return 'en';
}

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
    body: JSON.stringify({ q, source, target, format: 'text', api_key: apiKey || undefined })
  });

  const bodyText = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${bodyText.slice(0, 160)}`);

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
  const out = [];

  for (const block of blocks) {
    let translated = null, lastErr = null;
    for (const ep of LT_ENDPOINTS.length ? LT_ENDPOINTS : ['https://libretranslate.de/translate']) {
      try {
        const t = await postLibreTranslate(ep, block, { source, target, apiKey });
        translated = t;
        if (process.env.DEBUG_TRANSLATOR) console.log(`[TRAD_OK] LT ${ep} => "${block.slice(0,40)}" -> "${t.slice(0,40)}"`);
        break;
      } catch (e) {
        lastErr = e;
        if (process.env.DEBUG_TRANSLATOR) console.warn(`[TRAD_ERR] LT ${ep}: ${e.message}`);
      }
    }
    if (translated === null) throw lastErr || new Error('LT sem resposta');
    out.push(translated);
  }
  return out.join('');
}

// ======================= MyMemory (sem 'auto') =======================
async function myMemoryOne(q, { source, target }) {
  // Nunca use 'auto' aqui!
  const src = (source || 'en').toUpperCase();
  const tgt = (target || 'pt-BR').toUpperCase();

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', q);
  url.searchParams.set('langpair', `${src}|${tgt}`);
  if (process.env.MYMEMORY_EMAIL) url.searchParams.set('de', process.env.MYMEMORY_EMAIL);

  const res = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  });

  const bodyText = await res.text();
  let data;
  try { data = JSON.parse(bodyText); }
  catch { throw new Error(`MyMemory JSON inválido: ${bodyText.slice(0,160)}`); }

  const status = data?.responseStatus;
  const translated = data?.responseData?.translatedText || '';
  if (status !== 200) {
    throw new Error(`MyMemory status ${status}: ${data?.responseDetails || translated || 'erro'}`);
  }
  return translated;
}

async function tryMyMemory(text, { source, target='pt' } = {}) {
  // normaliza destino p/ PT-BR (MyMemory entende bem)
  const mmTarget = (target && target.toLowerCase() === 'pt') ? 'pt-BR' : target;
  const src = source && source.toLowerCase() !== 'auto' ? source : guessLang(text);

  const blocks = chunkSoft(text, 450);
  const out = [];
  for (const b of blocks) {
    try {
      const t = await myMemoryOne(b, { source: src, target: mmTarget });
      if (process.env.DEBUG_TRANSLATOR) console.log(`[TRAD_MM_OK] ${src}->${mmTarget}: "${b.slice(0,40)}" -> "${t.slice(0,40)}"`);
      out.push(t);
    } catch (e) {
      if (process.env.DEBUG_TRANSLATOR) console.warn(`[TRAD_ERR] MyMemory ${src}->${mmTarget}: ${e.message}`);
      out.push(b); // mantém original do bloco
    }
    await new Promise(r => setTimeout(r, 120)); // gentil com o serviço
  }
  return out.join('');
}

// ======================= API principal =======================
export async function translate(text, { target='pt', source='auto' } = {}) {
  try {
    if (!text || !text.trim()) return '';

    // 1) LT em auto
    try {
      const t = await tryLibreTranslate(text, { source, target });
      if (changed(t, text)) return t;
    } catch {}

    // 2) LT forçando idioma se parecer inglês (ajuda muito)
    const guess = guessLang(text);
    if (guess === 'en') {
      try {
        const t2 = await tryLibreTranslate(text, { source: 'en', target });
        if (changed(t2, text)) return t2;
      } catch {}
    }

    // 3) MyMemory SEM 'auto' (usa guessLang)
    try {
      const mm = await tryMyMemory(text, { source: guess, target });
      if (changed(mm, text)) return mm;
    } catch {}

    // 4) como extra: se não parecia EN, tenta MM forçando EN (às vezes resolve)
    if (guess !== 'en') {
      try {
        const mm2 = await tryMyMemory(text, { source: 'en', target });
        if (changed(mm2, text)) return mm2;
      } catch {}
    }

    if (process.env.DEBUG_TRANSLATOR) console.warn('[TRAD_FALLBACK_ORIGINAL] Sem tradução confiável; mantendo original.');
    return text;
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
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!pieces.length) return html;

    const joined = pieces.join('\n\n');
    const t = await translate(joined, { target: 'pt' }); // target 'pt' (LT) vira 'pt-BR' no MM
    const back = (t || '').split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);

    const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
  } catch {
    return html;
  }
}

// (opcional) várias strings em série
export async function translateMany(arr, opts = {}) {
  const results = [];
  for (const s of (arr || [])) results.push(await translate(s, opts));
  return results;
}
