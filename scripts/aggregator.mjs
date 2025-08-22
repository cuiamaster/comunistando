import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import sources from './sources.js';

const OUT_JSON = path.resolve('public/data/news.json');
const OUT_RSS  = path.resolve('public/rss');
const parser = new Parser({ timeout: 15000 });

const SITE = {
  baseUrl: 'https://cuiamaster.github.io/comunistando', // troque se seu usuário for outro
  adsClient: 'ca-pub-1234567890123456'
};

function slugify(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function rfc822(dateIso){ return new Date(dateIso||Date.now()).toUTCString(); }

// Tenta capturar imagem (og:image / twitter:image) da página da matéria
async function getOgImage(url) {
  try {
    const html = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' } }).then(r => r.text());
    const $ = cheerio.load(html);
    return $('meta[property="og:image"]').attr('content')
        || $('meta[name="twitter:image"]').attr('content')
        || '';
  } catch {
    return '';
  }
}

// Pega ATÉ 3 itens do feed + imagem quando houver
async function fromRSS(src) {
  const feed = await parser.parseURL(src.url);
  const items = (feed.items || []).slice(0, 3);
  const out = [];
  for (const item of items) {
    const link = item.link || feed.link || src.url;
    let image = item.enclosure?.url || '';
    if (!image) image = await getOgImage(link);
    out.push({
      country: src.country,
      title: (item.title || 'Sem título').trim(),
      summary: (item.contentSnippet || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      sourceName: (new URL(feed.link || src.url)).hostname,
      sourceUrl: link,
      imageUrl: image || ''
    });
  }
  return out;
}

// Para sites sem RSS, pega a primeira matéria da home e tenta imagem
async function fromScrape(src) {
  const res = await fetch(src.url, { headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const linkEl = $(src.pick?.selector).first();
  const link = new URL(linkEl.attr('href') || src.url, src.url).toString();

  const page = await fetch(link, { headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' } }).then(r => r.text()).catch(() => '');
  const $$ = cheerio.load(page);
  const title = $$('meta[property="og:title"]').attr('content') || $$('h1').first().text() || $('title').text();
  const desc  = $$('meta[name="description"]').attr('content') || $$('p').first().text() || '';
  const published = $$('meta[property="article:published_time"]').attr('content') || $$('time').attr('datetime') || new Date().toISOString();
  const image = $$('meta[property="og:image"]').attr('content') || $$('meta[name="twitter:image"]').attr('content') || '';

  return [{
    country: src.country,
    title: title.trim(),
    summary: desc.replace(/\s+/g, ' ').trim().slice(0, 260),
    publishedAt: published,
    sourceName: (new URL(link)).hostname,
    sourceUrl: link,
    imageUrl: image || ''
  }];
}

// Monta RSS
function buildRSS({ items, title, link, description }) {
  const rssItems = items.map(n => `
    <item>
      <title><![CDATA[${n.title}]]></title>
      <link>${n.sourceUrl}</link>
      <description><![CDATA[${n.summary}]]></description>
      <pubDate>${rfc822(n.publishedAt)}</pubDate>
      <source url="${n.sourceUrl}">${n.sourceName}</source>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>${link}</link>
    <description>${description}</description>
    <language>pt-BR</language>
${rssItems}
  </channel>
</rss>`;
}

// Escreve RSS (geral e por país)
async function writeRSS(allNews, countries) {
  await fs.mkdir(OUT_RSS, { recursive: true });

  const general = buildRSS({
    items: allNews,
    title: 'Comunistando — Feed Geral',
    link: `${SITE.baseUrl}/`,
    description: 'Breaking News do mundo socialista (feed geral)'
  });
  await fs.writeFile(path.resolve('public/rss/index.xml'), general, 'utf-8');

  for (const country of countries) {
    const slug = slugify(country).replace('vietnao','vietna');
    const items = allNews.filter(n => n.country === country);
    const xml = buildRSS({
      items,
      title: `Comunistando — ${country}`,
      link: `${SITE.baseUrl}/categoria/${slug}/`,
      description: `Breaking News — ${country}`
    });
    await fs.writeFile(path.resolve(`public/rss/${slug}.xml`), xml, 'utf-8');
  }
}

async function run() {
  const jobs = sources.map(async (src) => {
    try { return src.type === 'rss' ? await fromRSS(src) : await fromScrape(src); }
    catch (err) { console.error('Falha em', src.country, err.message); return null; }
  });

  const fetched = (await Promise.all(jobs)).filter(Boolean);
  const results = fetched.flat(); // RSS pode trazer vários itens

  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, JSON.stringify(results, null, 2), 'utf-8');

  const countries = [...new Set(sources.map(s => s.country))];

  // Sitemap simples (home + categorias estáticas que já existem em public/)
  const urls = [`${SITE.baseUrl}/`, ...countries.map(c => `${SITE.baseUrl}/categoria/${slugify(c)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  await fs.writeFile(path.resolve('public/sitemap.xml'), sitemap, 'utf-8');

  await writeRSS(results, countries);

  console.log('News + sitemap + RSS gerados com sucesso.');
}
run().catch((e)=>{ console.error(e); process.exit(1); });
