// scripts/translator.mjs
// Tradução para pt-BR com prioridade LibreTranslate (se houver endpoint nos Secrets)
// e fallback MyMemory. Evita exceder limites e nunca imprime mensagens de erro no HTML.

const LT_ENDPOINT = process.env.LT_ENDPOINT || ''; // deixe vazio se não tiver
const LT_API_KEY  = process.env.LT_API_KEY || '';
const LT_CONFIGURED = Boolean(LT_ENDPOINT);

// util
function chunk(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}
function esc(s='') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------------- LibreTranslate ----------------
async function translateViaLibreTranslate(text, { target = 'pt', source = 'auto' } = {}) {
  if (!LT_CONFIGURED) throw new Error('LT not configured');
  const blocks = chunk(text, 4500);
  const translated = [];
  for (const q of blocks) {
    const res = await fetch(LT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q, source, target, format: 'text',
        api_key: LT_API_KEY || undefined
      })
    });
    if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`);
    const data = await res.json();
    translated.push(data?.translatedText || '');
  }
  return translated.join('');
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
    let t = '';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
      const data = await res.json();
      const status = data?.responseStatus;
      t = data?.responseData?.translatedText || '';
      // Se vier aviso/erro no texto, usa original daquele pedaço
      if (status !== 200 || /QUERY LENGTH LIMIT|MYMEMORY WARNING|INVALID|PLEASE INVOKE/i.test(t)) {
        translated.push(q);
      } else {
        translated.push(t);
      }
    } catch {
      translated.push(q); // rede/limite: mantém original para não quebrar
    }
  }
  return translated.join('');
}

// ---------------- API pública ----------------
export async function translate(text, opts = {}) {
  if (!text) return '';
  try {
    // tenta LT se configurado
    return await translateViaLibreTranslate(text, opts);
  } catch (e) {
    // cai para MyMemory (ou mantém original se também falhar)
  }
  try {
    return await translateViaMyMemory(text, opts);
  } catch {
    return text;
  }
}

// Traduz HTML com <p>…</p>
// - Se LT configurado: traduz tudo (em blocos grandes).
// - Se sem LT: traduz APENAS até ~430 chars (2 parágrafos máx) em uma chamada (evita limite),
//   e o restante fica no idioma original (mas sem mensagens de erro).
export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!parts.length) return html;

    const clean = parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

    if (LT_CONFIGURED) {
      // junta tudo e traduz com LT (robusto, sem limites apertados)
      const joined = clean.join('\n\n');
      const t = await translate(joined, { target: 'pt' });
      const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);
      return back.map(seg => `<p>${esc(seg)}</p>`).join('\n');
    }

    // ---- caminho MyMemory: 1 chamada só, <= 430 chars, 2 parágrafos máx ----
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
