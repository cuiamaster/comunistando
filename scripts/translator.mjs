// scripts/translator.mjs
// Tradução para pt-BR com prioridade LibreTranslate (vários endpoints) e fallback MyMemory,
// evitando estourar limites e suprimir mensagens de erro no HTML.

// 1) Secrets (se existirem)
const LT_ENDPOINT_SECRET = process.env.LT_ENDPOINT || '';
const LT_API_KEY  = process.env.LT_API_KEY || '';

// 2) Candidatos de endpoints LT (ordem de tentativa)
const LT_CANDIDATES = [
  LT_ENDPOINT_SECRET,                                    // Secrets do repositório (recomendado)
  'https://translate.argosopentech.com/translate',       // público (estável na prática)
  'https://libretranslate.com/translate'                 // público oficial (limites variáveis)
].filter(Boolean);

// util
function chunk(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}
function esc(s='') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------------- LibreTranslate (com rotação de endpoints) ----------------
async function translateViaLibreTranslateAny(text, { target = 'pt', source = 'auto' } = {}) {
  if (!LT_CANDIDATES.length) throw new Error('No LT endpoints');
  const blocks = chunk(text, 4500);

  let lastErr;
  for (const endpoint of LT_CANDIDATES) {
    try {
      const translated = [];
      for (const q of blocks) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q, source, target, format: 'text',
            api_key: LT_API_KEY || undefined
          })
        });
        if (!res.ok) throw new Error(`LT ${endpoint} HTTP ${res.status}`);
        const data = await res.json();
        translated.push(data?.translatedText || '');
      }
      return translated.join('');
    } catch (e) {
      lastErr = e;
      // tenta próximo endpoint
    }
  }
  throw lastErr || new Error('All LT endpoints failed');
}

// ---------------- MyMemory (fallback) ----------------
function mapTarget(code) {
  if (!code) return 'pt-BR';
  return code.toLowerCase() === 'pt' ? 'pt-BR' : code;
}

async function translateViaMyMemory(text, { target = 'pt', source = 'auto' } = {}) {
  const tgt = mapTarget(target);
  const src = source || 'auto';

  // Mantemos cada requisição < 500 chars (limite do serviço)
  const blocks = chunk(text, 450);
  const translated = [];

  for (const q of blocks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(tgt)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
      const data = await res.json();
      const status = data?.responseStatus;
      let t = data?.responseData?.translatedText || '';

      // Se aparecer mensagem/aviso, preserva original para não “sujar” a página
      if (status !== 200 || /QUERY LENGTH LIMIT|WARNING|INVALID|PLEASE INVOKE/i.test(t)) {
        translated.push(q);
      } else {
        translated.push(t);
      }
    } catch {
      translated.push(q); // rede/limite: mantém original
    }
  }
  return translated.join('');
}

// ---------------- API pública ----------------
export async function translate(text, opts = {}) {
  if (!text) return '';
  // 1) tenta LT (vários endpoints)
  try { return await translateViaLibreTranslateAny(text, opts); } catch {}
  // 2) cai para MyMemory
  try { return await translateViaMyMemory(text, opts); } catch {}
  // 3) último recurso: original
  return text;
}

// Traduz HTML com <p>…</p>
// - Com LT: traduz tudo (em blocos grandes).
// - Sem LT (só MyMemory disponível/funcionando): traduz até ~430 chars (máx 2 parágrafos) numa chamada única,
//   e o restante fica no idioma original, para não estourar cota nem poluir com mensagens.
export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!parts.length) return html;

    const clean = parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

    // Tenta LT completo
    try {
      const joined = clean.join('\n\n');
      const t = await translateViaLibreTranslateAny(joined, { target: 'pt' });
      const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);
      return back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
    } catch {
      // continua para MyMemory limitado
    }

    // MyMemory: 1 chamada resumida (até 430 chars, 2 parágrafos)
    let buf = '';
    let count = 0;
    const maxChars = 430;
    for (const p of clean) {
      const candidate = buf ? `${buf}\n\n${p}` : p;
      if (candidate.length <= maxChars && count < 2) {
        buf = candidate;
        count++;
      } else {
        break;
      }
    }

    let translatedHtml = '';
    if (buf) {
      const t = await translateViaMyMemory(buf, { target: 'pt' });
      const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);
      translatedHtml = back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
    }

    const rest = clean.slice(count).map(p => `<p>${esc(p)}</p>`).join('\n');
    return [translatedHtml, rest].filter(Boolean).join('\n');
  } catch {
    return html;
  }
}
