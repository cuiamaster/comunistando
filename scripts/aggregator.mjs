// scripts/aggregator.mjs
// Coleta notícias das fontes, salva em public/data/news.json,
// gera RSS (geral e por país) e sitemap.xml.
// Projeto: Comunistando

import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import sources from './sources.js'; // << NÃO REMOVER

// ===================== Helpers de URL/HTTPS =====================
function toAbsoluteUrl(possibleUrl, baseUrl) {
  try {
    if (!possibleUrl) return '';
    // Ex.: //img.site.com/p.png -> https://img.site.com/p.png
    if (possibleUrl.startsWith('//')) return 'https:' + possibleUrl;
    // Resolve relativa: /img/p.png -> https://dominio-da-pagina/img/p.png
    return new URL(possibleUrl, baseUrl).toString();
  } catch {
    return possibleUrl; // devolve como veio se não der pra resolver
  }
}

function preferHttps(urlStr) {
  try {
    if (!urlStr) return '';
    const u = new URL(urlStr);
    if (u.protocol === 'http:') u.protocol = 'https:'; // “faz upgrade”
    return u.toString();
  } catch { return urlStr; }
}

// Proxy opcional para evitar bloqueio/hotlink/mixed content
function withImageProxy(urlStr) {
  if (!urlStr) return '';
  if (!SITE.imgProxy) return urlStr;
  // usa images.weserv.nl para servir por HTTPS
  const clean = urlStr.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}`;
}

// ===================== Caminhos de saída =====================
const OUT_JSON = path.resolve('public/data/news.json');
const OUT_RSS  = path.resolve('public/rss');

// ===================== Config do site =====================
const parser = new Parser({ timeout: 15000 });
const SITE = {
  baseUrl: 'https://cuiamaster.github.io/comunistando', // troque se seu usuário não for cuiamaster
  adsClient: 'ca-pub-1234567890123456', // placeholder
  imgProxy: true // << ative/desative o proxy de imagens
};

// ===================== Utilidades =====================
function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function rfc822(dateIso) {
  return new Date(dateIso || Date.now()).toUTCString();
}

// Tenta pegar a 1ª <img> útil do conteúdo (fallback quando não há og:image)
function extractFirstContentImage(html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    const imgSel = $('article img, .article img, .content img, .post img, img');
    const src = imgSel.first().attr('src') || '';
    if (!src) return '';
    let abs = toAbsoluteUrl(src, baseUrl);
    abs = preferHttps(abs);
    return encodeURI(abs);
  } catch {
    return '';
  }
}

// Pega imagem da página (og:image / twitter:image) com fallback na 1ª <img>
async function getOgImage(pageUrl) {
  try {
    const html = await fetch(pageUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' }
    }).then(r => r.text());
    const $ = cheerio.load(html);

    // 1) og:image / twitter:image
    let img =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    if (img) {
      img = toAbsoluteUrl(img, pageUrl);
      img = preferHttps(img);
      return encodeURI(img);
    }

    // 2) fallback: 1ª <img> do conteúdo
    const first = extractFirstContentImage(html, pageUrl);
    return first || '';
  } catch {
    return '';
  }
}

// ===================== Coleta via RSS (até 3 itens por fonte) =====================
async function fromRSS(src) {
  const feed = await parser.parseURL(src.url);
  const items = (feed.items || []).slice(0, 3);
  const out = [];
  for (const item of items) {
    let link = (item.link || '').trim();
    if (!link) continue;

    // normaliza o link (relativa -> absoluta) e prefere HTTPS
    link = toAbsoluteUrl(link, src.url);
    link = preferHttps(link);

    const title = (item.title || '').trim();
    if (!title) continue;

    // imagem: enclosure -> og:image -> 1ª <img>
    let image = item.enclosure?.url || '';
    if (image) {
      image = toAbsoluteUrl(image, link);
      image = preferHttps(image);
      image = encodeURI(image);
    } else {
      image = await getOgImage(link); // já tenta fallback
    }
    if (image) image = withImageProxy(image); // aplica proxy (se ativo)

    const summary = (item.contentSnippet || item.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 260);

    out.push({
      country: src.country,
      title,
      summary,
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      sourceName: (new URL(feed.link || src.url)).hostname,
      sourceUrl: link,
      imageUrl: image || ''
    });
  }
  return out;
}

// ===================== Coleta via scraping (pega 1ª matéria da home) =====================
async function fromScrape(src) {
  const res = await fetch(src.url, {
    headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  // acha o primeiro link de matéria na home, conforme selector da fonte
  const linkEl = $(src.pick?.selector).first();
  const href = linkEl.attr('href');
  if (!href) return []; // nada encontrado

  // normaliza o link (relativa -> absoluta) e força https
  let link = toAbsoluteUrl(href, src.url);
  link = preferHttps(link);

  // baixa a página da matéria
  const page = await fetch(link, {
    headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' }
  }).then(r => r.text()).catch(() => '');
  const $$ = cheerio.load(page);

  // título
  const title =
    ($$('meta[property="og:title"]').attr('content') ||
     $$('h1').first().text() ||
     $('title').text() ||
     '').trim();

  // resumo: meta description; senão, 1º parágrafo mais encorpado
  let desc = ($$('meta[name="description"]').attr('content') || '').trim();
  if (!desc) {
    const p = $$('p')
      .map((i, el) => $$(el).text().trim())
      .get()
      .find(t => t.length > 60);
    desc = (p || '').replace(/\s+/g, ' ').slice(0, 260);
  }

  // data de publicação
  const published =
    $$('meta[property="article:published_time"]').attr('content') ||
    $$('time').attr('datetime') ||
    new Date().toISOString();

  // imagem: og/twitter -> fallback 1ª <img>, normaliza e proxy
  let image =
    $$('meta[property="og:image"]').attr('content') ||
    $$('meta[name="twitter:image"]').attr('content') ||
    '';
  if (!image) {
    image = extractFirstContentImage(page, link);
  }
  if (image) {
    image = toAbsoluteUrl(image, link);
    image = preferHttps(image);
    image = encodeURI(image);
    image = withImageProxy(image); // aplica proxy (se ativo)
  }

  if (!title) return [];

  return [{
    country: src.country,
    title,
    summary: desc,
    publishedAt: published,
    sourceName: (new URL(link)).hostname,
    sourceUrl: link,
    imageUrl: image || ''
  }];
}

// ===================== RSS helpers =====================
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
    const slug = slugify(country);
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

// ===================== EXECUÇÃO PRINCIPAL =====================
async function run() {
  // 1) Executa todas as fontes (RSS ou scrape)
  const jobs = sources.map(async (src) => {
    try {
      return src.type === 'rss' ? await fromRSS(src) : await fromScrape(src);
    } catch (err) {
      console.error('Falha em', src.country, err.message);
      return null;
    }
  });

  // 2) Junta todos os itens
  const fetched = (await Promise.all(jobs)).filter(Boolean);
  const results = fetched.flat();

  // 3) Não sobrescrever JSON com vazio (preserva o anterior)
  let final = results;
  try {
    const prev = JSON.parse(await fs.readFile(OUT_JSON, 'utf-8'));
    if (final.length === 0 && Array.isArray(prev) && prev.length) {
      console.warn('Sem notícias novas; mantendo o arquivo anterior.');
      final = prev;
    }
  } catch {
    // Sem arquivo anterior — segue o fluxo
  }

  // 4) Grava o JSON final
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, JSON.stringify(final, null, 2), 'utf-8');

  // 5) Países, sitemap e RSS
  const countries = [...new Set(sources.map(s => s.country))];

  const urls = [`${SITE.baseUrl}/`, ...countries.map(c => `${SITE.baseUrl}/categoria/${slugify(c)}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  await fs.writeFile(path.resolve('public/sitemap.xml'), sitemap, 'utf-8');

  await writeRSS(final, countries);

  console.log(`News: ${final.length} itens publicados. Sitemap e RSS gerados.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
