// scripts/translator.mjs
// Traduz texto para pt-BR com fallback entre múltiplos endpoints compatíveis com LibreTranslate.
// Se LT_ENDPOINT/LT_API_KEY estiverem em Secrets, usa primeiro; senão tenta espelhos públicos.
// Com DEBUG_TRANSLATOR=1 no ambiente, loga [TRAD_OK] / [TRAD_ERR] / [TRAD_FALLBACK_ORIGINAL].
//
// Dica: em .github/workflows/publish.yml, passe os envs:
//   LT_ENDPOINT: ${{ secrets.LT_ENDPOINT }}
//   LT_API_KEY: ${{ secrets.LT_API_KEY }}
//   DEBUG_TRANSLATOR: '1'   # opcional, só para log

const FALLBACK_ENDPOINTS = [
  process.env.LT_ENDPOINT,                          // (secreto do repositório, se existir)
  'https://libretranslate.de/translate',            // espelho público
  'https://libretranslate.com/translate',           // oficial (pode rate-limitar)
  'https://translate.argosopentech.com/translate'   // espelho público
].filter(Boolean);

const USER_AGENT = 'ComunistandoBot/1.0 (+https://github.com/cuiamaster/comunistando)';

// Divide textos longos em blocos menores (evita payloads grandes demais)
function chunk(str, size = 4000) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}

// Faz 1 chamada ao endpoint LibreTranslate
async function postLibreTranslate(endpoint, q, { source = 'auto', target = 'pt', apiKey }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    // timeout de 15s (Node 18+/20+)
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
  catch { throw new Error(`JSON inválido do endpoint: ${bodyText.slice(0, 160)}`); }

  // Implementações retornam { translatedText: '...' }
  const out = data?.translatedText || (Array.isArray(data) ? data[0]?.translatedText : '');
  if (!out) throw new Error('Sem translatedText na resposta');
  return out;
}

// Traduz um único texto (string) para pt-BR
export async function translate(text, { target = 'pt', source = 'auto' } = {}) {
  try {
    if (!text || !text.trim()) return '';

    const endpoints = FALLBACK_ENDPOINTS.length
      ? FALLBACK_ENDPOINTS
      : ['https://libretranslate.de/translate']; // fallback final mínimo

    const blocks = chunk(text, 4000);
    const apiKey = process.env.LT_API_KEY || undefined;
    const translatedBlocks = [];

    for (const block of blocks) {
      let translated = null;

      for (const ep of endpoints) {
        try {
          const t = await postLibreTranslate(ep, block, { source, target, apiKey });
          translated = t;
          if (process.env.DEBUG_TRANSLATOR) {
            console.log(`[TRAD_OK] ${ep} => "${block.slice(0, 40)}" -> "${t.slice(0, 40)}"`);
          }
          break; // funcionou neste endpoint, para de tentar os outros
        } catch (e) {
          if (process.env.DEBUG_TRANSLATOR) {
            console.warn(`[TRAD_ERR] ${ep}: ${e.message}`);
          }
          // tenta próximo endpoint
        }
      }

      if (translated === null) {
        if (process.env.DEBUG_TRANSLATOR) {
          console.warn('[TRAD_FALLBACK_ORIGINAL] Mantendo bloco original (todos endpoints falharam).');
        }
        translated = block; // último recurso: mantém original
      }

      translatedBlocks.push(translated);
    }

    return translatedBlocks.join('');
  } catch (e) {
    console.warn('Falha na tradução, usando original:', e.message);
    return text;
  }
}

// Traduz HTML simples de parágrafos (<p>...</p>) preservando tags
export async function translateHtmlParagraphs(html) {
  try {
    const pieces = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim()); // tira a tag <p> de abertura

    if (!pieces.length) return html;

    const joined = pieces.join('\n\n');
    const t = await translate(joined, { target: 'pt' });
    const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);

    // reempacota em <p>...</p> escapando HTML
    return back.map(seg =>
      `<p>${seg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
    ).join('\n');
  } catch {
    return html;
  }
}

// (Opcional) Helper para traduzir várias strings de uma vez
export async function translateMany(arr, opts = {}) {
  const results = [];
  for (const s of arr) {
    // serial para não sobrecarregar os endpoints gratuitos
    results.push(await translate(s, opts));
  }
  return results;
}
