import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import sources from './sources.js'; // << ESSA LINHA É OBRIGATÓRIA
async function run() {
  // 1) Executa todas as fontes (RSS ou scrape)
  const jobs = sources.map(async (src) => {
    try { return src.type === 'rss' ? await fromRSS(src) : await fromScrape(src); }
    catch (err) { console.error('Falha em', src.country, err.message); return null; }
  });

  // 2) Junta todos os itens; RSS pode trazer vários (usamos flat)
  const fetched = (await Promise.all(jobs)).filter(Boolean);
  const results = fetched.flat();

  // 3) >>> BLOCO “NÃO SALVAR JSON VAZIO” <<<
  // Se hoje coletamos 0 itens mas já existe um arquivo anterior com notícias,
  // mantemos o conteúdo anterior para não deixar a home vazia.
  let final = results;
  try {
    const prev = JSON.parse(await fs.readFile(OUT_JSON, 'utf-8'));
    if (final.length === 0 && Array.isArray(prev) && prev.length) {
      console.warn('Sem notícias novas; mantendo o arquivo anterior.');
      final = prev;
    }
  } catch {
    // Se não existe arquivo anterior, segue com o que temos (pode ser vazio na 1ª vez)
  }

  // 4) Grava o JSON final (ou o anterior, se aplicável)
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, JSON.stringify(final, null, 2), 'utf-8');

  // 5) Países (para RSS por categoria e sitemap)
  const countries = [...new Set(sources.map(s => s.country))];

  // 6) Sitemap simples (home + categorias estáticas que já estão em public/)
  const urls = [`${SITE.baseUrl}/`, ...countries.map(c => `${SITE.baseUrl}/categoria/${slugify(c)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  await fs.writeFile(path.resolve('public/sitemap.xml'), sitemap, 'utf-8');

  // 7) RSS (geral e por país) com o que foi publicado em final
  await writeRSS(final, countries);

  console.log(`News: ${final.length} itens publicados. Sitemap e RSS gerados.`);
}

run().catch((e)=>{ console.error(e); process.exit(1); });
