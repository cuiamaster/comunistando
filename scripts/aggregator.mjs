import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import sources from './sources.js';

const OUT_JSON = path.resolve('public/data/news.json');
const OUT_DIR = path.resolve('public/categoria');
const OUT_RSS = path.resolve('public/rss');
const parser = new Parser({ timeout: 15000 });

const SITE = {
  // Se seu usuário NÃO for "cuiamaster", troque para o seu:
  baseUrl: 'https://cuiamaster.github.io/comunistando',
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

// Agora pegamos ATÉ 3 itens do feed e tentamos imagem
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

// Para sites sem RSS, achamos o link da primeira matéria e tentamos pegar a imagem
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

// Template das páginas de categoria (agora com imagem)
function categoryTemplate({ country, slug }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${country} — Comunistando</title>
  <meta name="description" content="Últimas manchetes de ${country} no Comunistando." />
  <link rel="icon" href="../../favicon.ico" type="image/x-icon" />
  <link rel="stylesheet" href="../../styles.css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${SITE.adsClient}" crossorigin="anonymous"></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type":"ListItem","position":1,"name":"Home","item":"${SITE.baseUrl}/"},
      {"@type":"ListItem","position":2,"name":"${country}","item":"${SITE.baseUrl}/categoria/${slug}/"}
    ]
  }
  </script>
</head>
<body class="bg-gradient-to-br from-red-900 via-zinc-900 to-black text-zinc-100 font-sans">
  <header class="bg-gradient-to-r from-red-800 via-red-700 to-red-600 text-white shadow-xl">
    <div class="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
      <a href="../../" class="text-2xl font-extrabold">🟥 Comunistando</a>
      <nav class="text-sm flex gap-3 text-white/90">
        <a href="../china/">China</a>
        <a href="../russia/">Rússia</a>
        <a href="../india-analises-sul-sul/">Índia</a>
        <a href="../cuba/">Cuba</a>
        <a href="../vietna/">Vietnã</a>
        <a href="../coreia-do-norte/">Coreia do Norte</a>
        <a href="../laos/">Laos</a>
        <a href="../venezuela/">Venezuela</a>
      </nav>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
    <section class="lg:col-span-8 flex flex-col gap-6" id="news-list">
      <nav class="text-xs text-zinc-300 mb-2">
        <a class="underline" href="../../">Home</a> <span>›</span> <span>${country}</span>
      </nav>
      <h1 class="text-3xl font-bold">${country}</h1>
    </section>
    <aside class="lg:col-span-4">
      <div class="sticky top-6 flex flex-col gap-6">
        <div class="bg-zinc-800 border border-zinc-700 shadow-lg rounded-2xl p-5">
          <h2 class="font-semibold mb-2 text-red-400">Anúncios</h2>
          <ins class="adsbygoogle" style="display:block" data-ad-client="${SITE.adsClient}" data-ad-slot="0987654321" data-ad-format="auto" data-full-width-responsive="true"></ins>
          <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
        </div>
      </div>
    </aside>
  </main>

  <footer class="border-t border-zinc-800 bg-zinc-900">
    <div class="max-w-6xl mx-auto px-4 py-6 text-sm text-zinc-400 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <span>© <span id="year"></span> Comunistando.</span>
      <a class="underline" href="../../">Voltar para a Home</a>
    </div>
  </footer>

  <script>
    document.getElementById('year').textContent = new Date().getFullYear();
    const COUNTRY = ${JSON.stringify(country)};
    function escapeHtml(s=''){return s.replace(/[&<>\"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\\'':'&#39;'}[c]));}
    function formatDate(iso){try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));}catch{return '';}}
    fetch('../../data/news.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(items => items.filter(n => n.country === COUNTRY))
      .then(items => {
        const host = document.getElementById('news-list');
        items.forEach(n => {
          const card = document.createElement('article');
          card.className = 'bg-zinc-800 border border-zinc-700 shadow-lg rounded-2xl p-5 hover:border-red-600 transition-colors';
          card.innerHTML = \`
            <div class="flex items-center justify-between gap-3 mb-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-red-400">\${COUNTRY}</span>
              <time class="text-xs text-zinc-400">\${formatDate(n.publishedAt)}</time>
            </div>
            \${n.imageUrl ? \`<a href="\${n.sourceUrl}" target="_blank" rel="noopener noreferrer">
              <img src="\${n.imageUrl}" alt="" class="w-full h-48 object-cover rounded-xl mb-3 border border-zinc-700" onerror="this.remove()"/>
            </a>\` : ``}
            <h3 class="text-xl font-bold leading-tight mb-2 text-white">\${escapeHtml(n.title)}</h3>
            <p class="text-zinc-300 mb-3">\${escapeHtml(n.summary)}</p>
            <a class="inline-flex items-center gap-2 text-red-400 hover:text-red-300 font-medium" href="\${n.sourceUrl}" target="_blank" rel="noopener noreferrer">Fonte: \${escapeHtml(n.sourceName)} →</a>\`;
          host.appendChild(card);
        });
      })
      .catch(() => {});
  </script>
</body>
</html>`;
}

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

async function writeCategoryPages(countries) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const country of countries) {
    const slug = slugify(country).replace('vietnao','vietna');
    const dir = path.join(OUT_DIR, slug);
    await fs.mkdir(dir, { recursive: true });
    const html = categoryTemplate({ country, slug });
    await fs.writeFile(path.join(dir, 'index.html'), html, 'utf-8');
  }
}

async function writeRSS(allNews, countries) {
  await fs.mkdir(OUT_RSS, { recursive: true });
  const general = buildRSS({
    items: allNews,
    title: 'Comunistando — Feed Geral',
    link: `${SITE.baseUrl}/`,
    description: 'Breaking News do mundo socialista (feed geral)'
  });
  await fs.writeFile(path.join(OUT_RSS, 'index.xml'), general, 'utf-8');

  for (const country of countries) {
    const slug = slugify(country).replace('vietnao','vietna');
    const items = allNews.filter(n => n.country === country);
    const xml = buildRSS({
      items,
      title: `Comunistando — ${country}`,
      link: `${SITE.baseUrl}/categoria/${slug}/`,
      description: `Breaking News — ${country}`
    });
    await fs.writeFile(path.join(OUT_RSS, `${slug}.xml`), xml, 'utf-8');
  }
}

async function run() {
  const jobs = sources.map(async (src) => {
    try { return src.type === 'rss' ? await fromRSS(src) : await fromScrape(src); }
    catch (err) { console.error('Falha em', src.country, err.message); return null; }
  });
  const fetched = (await Promise.all(jobs)).filter(Boolean);
  const results = fetched.flat(); // achatando (RSS traz vários itens)

  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, JSON.stringify(results, null, 2), 'utf-8');

  const countries = [...new Set(sources.map(s => s.country))];
  await writeCategoryPages(countries);

  const urls = [`${SITE.baseUrl}/`, ...countries.map(c => `${SITE.baseUrl}/categoria/${slugify(c)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  await fs.writeFile(path.resolve('public/sitemap.xml'), sitemap, 'utf-8');

  await writeRSS(results, countries);
  console.log('News + categorias + sitemap + RSS gerados.');
}
run().catch((e)=>{ console.error(e); process.exit(1); });
