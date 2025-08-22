// scripts/translator.mjs
// Traduz texto para pt-BR via LibreTranslate (ou outro endpoint compatível).
// Se LT_ENDPOINT/LT_API_KEY forem definidos nos "Secrets", usa-os.
// Caso contrário, usa o endpoint público padrão (pode ser instável).

const DEFAULT_ENDPOINT = 'https://libretranslate.com/translate';

// Divide textos longos em blocos menores (seguro p/ API)
function chunk(str, size = 4500) {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}

export async function translate(text, { target = 'pt', source = 'auto' } = {}) {
  try {
    if (!text) return '';
    const endpoint = process.env.LT_ENDPOINT || DEFAULT_ENDPOINT;
    const apiKey = process.env.LT_API_KEY || undefined;

    // Se for pequeno, vai direto. Se for grande, por blocos.
    const blocks = chunk(text, 4500);
    const translated = [];
    for (const q of blocks) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q,
          source,
          target,
          format: 'text',
          api_key: apiKey
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      translated.push(data?.translatedText || '');
    }
    return translated.join('');
  } catch (e) {
    console.warn('Falha na tradução, usando original:', e.message);
    return text; // fallback: devolve original
  }
}

// Traduz HTML simples de parágrafos (<p>...</p>) preservando tags
export async function translateHtmlParagraphs(html) {
  try {
    const parts = html
      .split(/<\/p>/i)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^<p[^>]*>/i, '').trim()); // conteúdo sem <p>

    if (!parts.length) return html;

    const joined = parts.join('\n\n');
    const t = await translate(joined, { target: 'pt' });
    const back = t.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);

    // re-empacota em <p>...</p>
    return back.map(seg =>
      `<p>${seg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
    ).join('\n');
  } catch {
    return html;
  }
}
