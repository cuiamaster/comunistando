// scripts/translator.mjs
// Tradutor robusto p/ pt-BR usando LibreTranslate-compat.
// - Usa LT_ENDPOINT/LT_API_KEY se definidos (Secrets).
// - Faz retries com backoff e tem endpoints de fallback.
// - Aceita respostas {translatedText} ou [{translatedText}].
// - Para HTML de <p>...</p>, decodifica entidades antes e reescapa após.

// ---------- Config ----------
const PRIMARY_ENDPOINT = process.env.LT_ENDPOINT || 'https://libretranslate.com/translate';
// Endpoints de fallback (pode ajustar/encurtar depois se quiser)
const FALLBACK_ENDPOINTS = [
  'https://translate.terraprint.co/translate',
  'https://libretranslate.de/translate',
];

const API_KEY = process.env.LT_API_KEY || undefined;

// ---------- Utils ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunk(str, size = 4000) {
  if (!str) return [''];
  const out = [];
  let i = 0;
  while (i < str.length) {
    out.push(str.slice(i, i + size));
    i += size;
  }
  return out;
}

// Decodifica entidades HTML simples para mandar texto limpo à API
function htmlDecode(s = '') {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Reescapa após traduzir para voltar seguro ao HTML
function htmlEncode(s = '') {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Lê a resposta da API em ambos os formatos
async function parseLTResponse(res) {
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LibreTranslate HTTP ${res.status} ${txt ? '- ' + txt.slice(0, 120) : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) {
    const t = data[0]?.translatedText;
    if (typeof t === 'string' && t.length) return t;
  } else if (data && typeof data.translatedText === 'string') {
    return data.translatedText;
  }
  // fallback se vier em formato estranho
  return '';
}

async function requestLT(endpoint, q, { source = 'auto', target = 'pt', format = 'text' } = {}) {
  const body = { q, source, target, format };
  if (API_KEY) body.api_key = API_KEY;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseLTResponse(res);
}

// ---------- API: translate (texto plano) ----------
export async function translate(text, { target = 'pt', source = 'auto' } = {}) {
  try {
    if (!text || !text.trim()) return text;

    // lista de tentativas: 1) primário; 2...) fallbacks
    const endpoints = [PRIMARY_ENDPOINT, ...FALLBACK_ENDPOINTS];

    const blocks = chunk(text, 4000);
    const translatedBlocks = [];

    for (const q of blocks) {
      let lastErr = null;
      let got = '';

      for (let e = 0; e < endpoints.length && !got; e++) {
        const ep = endpoints[e];
        // até 2 tentativas por endpoint (com backoff)
        for (let attempt = 1; attempt <= 2 && !got; attempt++) {
          try {
            got = await requestLT(ep, q, { source, target, format: 'text' });
            if (!got) throw new Error('Resposta vazia do tradutor');
          } catch (err) {
            lastErr = err;
            // 1º erro no endpoint atual → pequeno backoff e tenta de novo
            await sleep(600 * attempt);
          }
        }
      }

      if (!got) {
        // Não conseguimos traduzir este bloco — preserva original (não quebra build)
        console.warn('[translator] Falha ao traduzir bloco, mantendo original. Último erro:', lastErr?.message || lastErr);
        translatedBlocks.push(q);
      } else {
        translatedBlocks.push(got);
      }
    }

    return translatedBlocks.join('');
  } catch (e) {
    console.warn('[translator] Falha geral na tradução, mantendo original:', e.message);
    return text;
  }
}

// ---------- API: translateHtmlParagraphs (<p>...</p>) ----------
export async function translateHtmlParagraphs(html) {
  try {
    if (!html || !html.trim()) return html;

    // Se não tiver <p>, trata tudo como texto plano
    const hasP = /<\s*p[\s>]/i.test(html);
    if (!hasP) {
      const dec = htmlDecode(html);
      const t = await translate(dec, { target: 'pt' });
      return htmlEncode(t);
    }

    // Captura blocos <p>...</p> (simples e suficiente p/ nosso caso)
    const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    if (!matches.length) {
      const dec = htmlDecode(html);
      const t = await translate(dec, { target: 'pt' });
      return htmlEncode(t);
    }

    const out = [];
    for (const m of matches) {
      const innerRaw = m[1] || '';
      const innerDec = htmlDecode(innerRaw);
      const t = await translate(innerDec, { target: 'pt' });
      out.push(`<p>${htmlEncode(t)}</p>`);
    }
    return out.join('\n');
  } catch (e) {
    console.warn('[translator] Falha ao traduzir HTML; devolvendo original:', e.message);
    return html;
  }
}
