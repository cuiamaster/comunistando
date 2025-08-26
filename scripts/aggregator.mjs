// scripts/aggregator.mjs
// Coleta notícias das fontes, traduz para pt-BR, salva em public/data/news.json,
// gera páginas internas por notícia (em /public/noticias/*.html), RSS (geral e por país)
// e sitemap.xml (home, categorias e artigos).
// Projeto: Comunistando

import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import sources from './sources.js';
import { translate, translateHtmlParagraphs } from './translator.mjs';

// ===================== Helpers de URL/HTTPS =====================
function toAbsoluteUrl(possibleUrl, baseUrl) {
  try {
    if (!possibleUrl) return '';
    if (possibleUrl.startsWith('//')) return 'https:' + possibleUrl; // //img -> https://img
    return new URL(possibleUrl, baseUrl).toString(); // resolve relativa
  } catch {
    return possibleUrl;
  }
}

function preferHttps(urlStr) {
  try {
    if (!urlStr) return '';
    const u = new URL(urlStr);
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch { return urlStr; }
}

// Proxy opcional para evitar bloqueio/hotlink/mixed content
function withImageProxy(urlStr) {
  if (!urlStr) return '';
  if (!SITE.imgProxy) return urlStr;
  const clean = urlStr.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(clean)}`;
}

// ===================== Caminhos de saída =====================
const OUT_JSON = path.resolve('public/data/news.json');
const OUT_RSS  = path.resolve('public/rss');

// ===================== Config do site =====================
const parser = new Parser({ timeout: 15000 });
const SITE = {
  baseUrl: 'https://cuiamaster.github.io/comunistando', // ajuste se seu usuário repositório mudar
  adsClient: 'ca-pub-1234567890123456', // placeholder
  imgProxy: true // proxy de imagens
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
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// Normaliza para comparar “traduzido x original”
function norm(s){ return (s||'').toString().trim().replace(/\s+/g,' ').toLowerCase(); }
// Heurística simples: parece inglês?
function looksEnglish(s){
  const t = (s||'').toLowerCase();
  const hits = [' the ',' and ',' of ',' to ',' in ',' for ',' with ',' on ',' from ',' by ']
    .reduce((acc,w)=> acc + (t.includes(w)?1:0), 0);
  return hits >= 2;
}

// ---------- Tradução robusta, item a item ----------
async function translateSmart(text){
  if (!text) return { out: '', changed:false, via:'none' };
  // 1) tenta auto
  let a = await translate(text, { target:'pt' });
  if (norm(a) && norm(a) !== norm(text)) return { out:a, changed:true, via:'auto' };
  // 2) se parece EN, força source:'en'
  if (looksEnglish(text)) {
    let b = await translate(text, { target:'pt', source:'en' });
    if (norm(b) && norm(b) !== norm(text)) return { out:b, changed:true, via:'en' };
  }
  // 3) sem mudança -> mantém
  return { out:text, changed:false, via:'none' };
}

// Tenta pegar a 1ª <img> útil do conteúdo (fallback quando não há og:image)
function extractFirstContentImage(html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    const imgSel = $('article img, .article img, .content img, .post img, main img, img');
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

    let img =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    if (img) {
      img = toAbsoluteUrl(img, pageUrl);
      img = preferHttps(img);
      return encodeURI(img);
    }

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

    link = toAbsoluteUrl(link, src.url);
    link = preferHttps(link);

    const titleRaw = (item.title || '').trim();
    if (!titleRaw) continue;

    // imagem: enclosure -> og:image -> 1ª <img>
    let image = item.enclosure?.url || '';
    if (image) {
      image = toAbsoluteUrl(image, link);
      image = preferHttps(image);
      image = encodeURI(image);
    } else {
      image = await getOgImage(link);
    }
    if (image) image = withImageProxy(image);

    // resumo bruto
    const summaryRaw = (item.contentSnippet || item.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 260);

    // Tradução item a item (com fallback)
    const [t, s] = await Promise.all([
      translateSmart(titleRaw),
      translateSmart(summaryRaw)
    ]);
    // Pausa mínima para evitar throttling agressivo em endpoints grátis
    await sleep(120);

    out.push({
      country: src.country,
      title: t.out,
      summary: s.out,
      publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
      sourceName: (new URL(feed.link || src.url)).hostname,
      sourceUrl: link,
      imageUrl: image || ''
    });

    console.log(`[TRAD_DEBUG][RSS:${src.country}] "${titleRaw}" -> "${t.out}" via ${t.via}`);
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
  const titleRaw =
    ($$('meta[property="og:title"]').attr('content') ||
     $$('h1').first().text() ||
     $('title').text() ||
     '').trim();

  // resumo: meta description; senão, 1º parágrafo mais encorpado
  let descRaw = ($$('meta[name="description"]').attr('content') || '').trim();
  if (!descRaw) {
    const p = $$('p')
      .map((i, el) => $$(el).text().trim())
      .get()
      .find(t => t.length > 60);
    descRaw = (p || '').replace(/\s+/g, ' ').slice(0, 260);
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
    image = withImageProxy(image);
  }

  if (!titleRaw) return [];

  // === Tradução (individual) ===
  const [t, d] = await Promise.all([
    translateSmart(titleRaw),
    translateSmart(descRaw)
  ]);

  console.log(`[TRAD_DEBUG][SCRAPE:${src.country}] "${titleRaw}" -> "${t.out}" via ${t.via}`);

  return [{
    country: src.country,
    title: t.out,
    summary: d.out,
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

// ===================== Gerador de páginas internas =====================
function renderArticleHTML({ item, bodyHtml }) {
  const pageTitle = `${item.title} — Comunistando`;
  const canonical = `${SITE.baseUrl}${item.permalink}`;
  const pubDate = new Date(item.publishedAt || Date.now()).toLocaleString('pt-BR');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <meta name="description" content="${(item.summary || '').replace(/"/g,'&quot;')}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${(item.title || '').replace(/"/g,'&quot;')}" />
  <meta property="og:description" content="${(item.summary || '').replace(/"/g,'&quot;')}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonical}" />
  ${item.imageUrl ? `<meta property="og:image" content="${item.imageUrl}" />` : ''}

  <!-- Tailwind para layout -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Seu CSS -->
  <link rel="stylesheet" href="../styles.css" />
</head>
<body class="min-h-screen bg-gradient-to-br from-red-900 via-zinc-900 to-black text-zinc-100 font-sans">
  <header class="bg-gradient-to-r from-red-800 via-red-700 to-red-600 text-white shadow-xl">
    <div class="max-w-6xl mx-auto px-4 py-6">
      <div class="flex items-center justify-between">
        <a href="../index.html" class="text-3xl md:text-4xl font-extrabold tracking-tight">🟥 Comunistando</a>
        <span class="text-white/90 text-sm">${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date())}</span>
      </div>
      <p class="text-white/90 max-w-3xl mt-2">Notícias diárias dos países socialistas e comunistas — em português do Brasil, com links e fontes oficiais.</p>
      <nav class="mt-4 text-sm flex flex-wrap gap-3 text-white/90">
        <a href="../categoria/china/">China</a>
        <a href="../categoria/russia/">Rússia</a>
        <a href="../categoria/india-analises-sul-sul/">Índia</a>
        <a href="../categoria/cuba/">Cuba</a>
        <a href="../categoria/vietna/">Vietnã</a>
        <a href="../categoria/coreia-do-norte/">Coreia do Norte</a>
        <a href="../categoria/laos/">Laos</a>
        <a href="../categoria/venezuela/">Venezuela</a>
      </nav>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-10">
    <nav class="text-sm text-zinc-400 mb-4">
      <a href="../index.html" class="hover:underline">Início</a> ·
      <a href="../categoria/${slugify(item.country)}/" class="hover:underline">${item.country}</a>
    </nav>

    <article class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-lg overflow-hidden">
      ${item.imageUrl ? `<img src="${item.imageUrl}" alt="" class="w-full aspect-video object-cover">` : ''}
      <div class="p-6 md:p-8">
        <h1 class="text-2xl md:text-3xl font-extrabold mb-2">${item.title}</h1>
        <div class="text-sm text-zinc-400 mb-5">
          ${item.country} · <time datetime="${item.publishedAt}">${pubDate}</time>
        </div>

        <p class="text-zinc-200 mb-5">${item.summary || ''}</p>

        <div class="prose prose-invert max-w-none">
          ${bodyHtml}
        </div>

        <div class="mt-8 p-4 rounded-xl bg-zinc-800 text-zinc-200">
          <strong>Fonte:</strong> <a href="${item.sourceUrl}" rel="nofollow noopener" target="_blank" class="underline">${item.sourceName}</a>
          <div class="text-xs text-zinc-400 mt-1">Trechos exibidos para fins de informação e citação, com link para a matéria original.</div>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <a class="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 font-medium"
             href="https://wa.me/?text=${encodeURIComponent(item.title + ' ' + canonical)}" target="_blank" rel="noopener">Compartilhar no WhatsApp</a>
          <a class="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-900 font-medium"
             href="https://twitter.com/intent/tweet?text=${encodeURIComponent(item.title)}&url=${encodeURIComponent(canonical)}" target="_blank" rel="noopener">Compartilhar no X</a>
        </div>
      </div>
    </article>
  </main>

  <footer class="border-t border-zinc-800 bg-zinc-900">
    <div class="max-w-6xl mx-auto px-4 py-6 text-sm text-zinc-400">
      © ${new Date().getFullYear()} Comunistando.
    </div>
  </footer>
</body>
</html>`;
}

// extrai até ~3 parágrafos do corpo (uso justo)
function extractPreviewParagraphs(html) {
  try {
    const $ = cheerio.load(html);
    const candidates = $('article p, .article p, .content p, .post p, main p, p');
    const texts = [];
    for (let i = 0; i < candidates.length; i++) {
      const t = $(candidates[i]).text().trim();
      if (t && t.length > 50) texts.push(t);
      if (texts.join('\n\n').length > 800 || texts.length >= 3) break;
    }
    if (!texts.length) return '<p>(Conteúdo completo disponível na matéria original.)</p>';
    const safe = texts
      .map(p => p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'))
      .join('</p><p>');
    return `<p>${safe}</p>`;
  } catch {
    return '<p>(Conteúdo completo disponível na matéria original.)</p>';
  }
}

async function writeArticlePages(items) {
  for (const item of items) {
    try {
      const html = await fetch(item.sourceUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 ComunistandoBot' }
      }).then(r => r.text()).catch(() => '');
      const preview = html ? extractPreviewParagraphs(html) : '<p>(Conteúdo indisponível no momento.)</p>';

      // corpo: tenta auto; se vier igual e parecer EN, força EN por parágrafo
      let bodyPT = await translateHtmlParagraphs(preview);
      if (norm(bodyPT) === norm(preview) && looksEnglish(preview.replace(/<[^>]+>/g,''))) {
        const parts = preview.split(/<\/p>/i).map(x=>x.trim()).filter(Boolean)
          .map(x => x.replace(/^<p[^>]*>/i,'').trim());
        const joined = parts.join('\n\n');
        const forced = await translate(joined, { target:'pt', source:'en' });
        const back = forced.split(/\n{2,}/).map(seg => seg.trim()).filter(Boolean);
        bodyPT = back.map(seg =>
          `<p>${seg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
        ).join('\n');
      }

      // título e resumo com fallback inteligente
      const [t, s] = await Promise.all([
        translateSmart(item.title || ''),
        translateSmart(item.summary || '')
      ]);

      const page = renderArticleHTML({
        item: { ...item, title: t.out, summary: s.out },
        bodyHtml: bodyPT
      });

      const outPath = path.resolve(`public${item.permalink}`);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, page, 'utf-8');
    } catch (e) {
      console.warn('Falha ao gerar página interna:', item.title, e.message);
    }
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

  // 2.1) Adiciona permalink para páginas internas
  const resultsWithPermalink = results.map((n) => {
    const slug = `${slugify(n.country)}-${slugify(n.title)}`.slice(0, 120);
    return { ...n, permalink: `/noticias/${slug}.html` };
  });

  // 3) Não sobrescrever JSON com vazio (preserva o anterior)
  let final = resultsWithPermalink;
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

  // 4.1) Gera páginas internas
  await writeArticlePages(final);

  // 5) Países, sitemap (home + categorias + artigos) e RSS
  const countries = [...new Set(sources.map(s => s.country))];

  const urls = [
    `${SITE.baseUrl}/`,
    ...countries.map(c => `${SITE.baseUrl}/categoria/${slugify(c)}/`),
    ...final.map(n => `${SITE.baseUrl}${n.permalink}`)
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  await fs.writeFile(path.resolve('public/sitemap.xml'), sitemap, 'utf-8');

  await writeRSS(final, countries);

  console.log(`News: ${final.length} itens publicados. Sitemap, RSS e páginas internas gerados.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
