// scripts/translator.mjs
// Tradução para pt-BR priorizando LibreTranslate (com rotação de endpoints) e
// fallback MyMemory com limites seguros. Loga qual backend foi usado.

const LT_ENDPOINT_SECRET = process.env.LT_ENDPOINT || '';
const LT_API_KEY = process.env.LT_API_KEY || '';

const LT_CANDIDATES = [
  LT_ENDPOINT_SECRET,
  'https://translate.argosopentech.com/translate',
  'https://libretranslate.com/translate',
].filter(Boolean);

let backendNoticeShown = false;
function noteOnce(msg) {
  if (!backendNoticeShown) {
    console.log('[translator]', msg);
    backendNoticeShown = true;
  }
}

function chunk(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}
function esc(s='') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------------- LibreTranslate ----------------
async function translateViaLT(text, { target = 'pt', source = 'auto' } = {}) {
  if (!LT_CANDIDATES.length) throw new Error('no LT endpoints');
  const parts = chunk(text, 4500);

  let lastErr;
  for (const ep of LT_CANDIDATES) {
    try {
      const translated = [];
      for (const q of parts) {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q, source, target, format: 'text',
            api_key: LT_API_KEY || undefined
          })
        });
        if (!res.ok) throw new Error(`LT ${ep} HTTP ${res.status}`);
        const data = await res.json();
        translated.push(data?.translatedText || '');
      }
      noteOnce(`usando LibreTranslate: ${ep}`);
      return translated.join('');
    } catch (e) { lastErr = e; /* tenta o próximo */ }
  }
  throw lastErr || new Error('LT failed');
}

// ---------------- MyMemory (fallback) ----------------
function mapTarget(code) {
  return (!code || code.toLowerCase() === 'pt') ? 'pt-BR' : code;
}
async function translateViaMyMemory(text, { target = 'pt', source = 'auto' } = {}) {
  const tgt = mapTarget(target);
  const src = source || 'auto';

  // Mantém queries curtas para não estourar
  const blocks = chunk(text, 430);
  const out = [];

  for (const q of blocks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(tgt)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MM HTTP ${res.status}`);
      const data = await res.json();
      const status = data?.responseStatus;
      let t = data?.responseData?.translatedText || '';
      if (status !== 200 || /QUERY LENGTH LIMIT|WARNING|INVALID|PLEASE INVOKE/i.test(t)) {
        out.push(q); // se a API reclamar, devolve original
      } else {
        out.push(t);
      }
    } catch { out.push(q); }
  }
  noteOnce('usando MyMemory (fallback)');
  return out.join('');
}

// ---------------- API pública ----------------
export async function translate(text, opts = {}) {
  if (!text) return '';
  try { return await translateViaLT(text, opts); } catch {}
  try { return await translateViaMyMemory(text, opts); } catch {}
  return text;
}

export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!parts.length) return html;

    // LT (todo o texto de uma vez)
    try {
      const joined = parts.join('\n\n');
      const t = await translateViaLT(joined, { target: 'pt' });
      const back = t.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      return back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
    } catch {/* cai pro MyMemory controlado */ }

    // MyMemory: só início, para evitar limites/erro feio
    const clean = parts.map(p => p.replace(/\s+/g, ' ').trim());
    let buf = '';
    let used = 0;
    for (const p of clean) {
      const cand = buf ? `${buf}\n\n${p}` : p;
      if (cand.length <= 430 && used < 2) { buf = cand; used++; } else { break; }
    }

    let translated = '';
    if (buf) {
      const t = await translateViaMyMemory(buf, { target: 'pt' });
      const back = t.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      translated = back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
    }
    const rest = clean.slice(used).map(p => `<p>${esc(p)}</p>`).join('\n');
    return [translated, rest].filter(Boolean).join('\n');
  } catch {
    return html;
  }
}
