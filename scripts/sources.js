export default [
  { country: 'China', type: 'scrape', url: 'https://news.cgtn.com/news/', pick: { selector: 'a[href*="2025-"], a[href*="/p.html"]' } },
  { country: 'Rússia', type: 'rss',   url: 'https://www.themoscowtimes.com/rss/news' },
  { country: 'Índia (análises Sul-Sul)', type: 'rss', url: 'https://www.newsclick.in/rss.xml' },
  { country: 'Cuba', type: 'rss', url: 'https://en.granma.cu/rss' },
  { country: 'Vietnã', type: 'rss', url: 'https://vnanet.vn/en/rss' },
  { country: 'Coreia do Norte', type: 'scrape', url: 'https://www.rodong.rep.kp/en/', pick: { selector: 'a[href*="index.php"], a[href*="/en/"]' } },
  { country: 'Laos', type: 'scrape', url: 'https://kpl.gov.la/En/', pick: { selector: 'a[href*="detail.aspx"]' } },
  { country: 'Venezuela', type: 'rss', url: 'https://avn.info.ve/feed/' }
];