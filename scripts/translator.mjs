// scripts/translator.mjs
// Traduz para pt-BR. Tenta LibreTranslate; se falhar, cai para MyMemory.
// Evita mensagens de erro no HTML e respeita limites de tamanho.

const LT_ENDPOINT = process.env.LT_ENDPOINT || 'https://libretranslate.com/translate';
const LT_API_KEY  = process.env.LT_API_KEY || '';

function chunk(str, size) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

// ---------------- LibreTranslate ----------------
async function translateViaLibreTranslate(text, { target = 'pt', source = 'auto' } = {}) {
  const blocks = chunk(text, 4500); // seguro para LT
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
  // Força pt-BR no MyMemory
  if (!code) return 'pt-BR';
  return code.toLowerCase() === 'pt' ? 'pt-BR' : code;
}

async function translateViaMyMemory(text, { target = 'pt', source = 'auto' } = {}) {
  const tgt = mapTarget(target);
  const src = source || 'auto';
  const blocks = chunk(text, 450); // < 500 para evitar LIMIT EXCEEDED
  const translated = [];

  for (const q of blocks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(tgt)}`;
    const res = await fetch(url);
    if (!res.ok) {
      // se der erro de rede, devolve o pedaço original (sem quebrar a página)
      translated.push(q);
      continue;
    }
    const data = await res.json();
    const status = data?.responseStatus;
    let t = data?.responseData?.translatedText || '';

    // Se status != 200 ou o serviço retornar aquela mensagem chata, usa texto original
    if (status !== 200 || /QUERY LENGTH LIMIT/i.test(t)) {
      translated.push(q);
    } else {
      translated.push(t);
    }
  }
  return translated.join('');
}

// ---------------- API pública ----------------
export async function translate(text, opts = {}) {
  try {
    if (!text) return '';
    // Tenta LT primeiro (se estiver acessível/permitido)
    return await translateViaLibreTranslate(text, opts);
  } catch (e) {
    console.warn('LibreTranslate falhou, caindo para MyMemory:', e.message);
  }
  try {
    return await translateViaMyMemory(text, opts);
  } catch (e) {
    console.warn('MyMemory falhou, mantendo original:', e.message);
    return text;
  }
}

// Traduz HTML com <p>…</p>, parágrafo por parágrafo (evita blocos enormes)
export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim());

    if (!parts.length) return html;

    const translated = [];
    for (const p of parts) {
      // guilhotina preventiva: evita blocos gigantes (LT aguenta, MyMemory não)
      const safe = p.slice(0, 3000);
      const t = await translate(safe, { target: 'pt' });
      translated.push(t);
    }

    // remonta HTML escapando tags no conteúdo
    return translated.map(seg =>
      `<p>${seg
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')}</p>`
    ).join('\n');
  } catch (e) {
    console.warn('translateHtmlParagraphs falhou, mantendo HTML original:', e.message);
    return html;
  }
}
