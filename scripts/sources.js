// scripts/sources.js
export default [
  // CHINA — China Daily (RSS oficial)
  { country: 'China', type: 'rss', url: 'http://www.chinadaily.com.cn/rss/china_rss.xml' },

  // RÚSSIA — The Moscow Times
  { country: 'Rússia', type: 'rss', url: 'https://www.themoscowtimes.com/rss/news' },

  // ÍNDIA — NewsClick
  { country: 'Índia (análises Sul-Sul)', type: 'rss', url: 'https://www.newsclick.in/rss-feed' },

  // CUBA — Prensa Latina
  { country: 'Cuba', type: 'rss', url: 'https://www.prensa-latina.cu/feed' },

  // VIETNÃ — Nhan Dan
  { country: 'Vietnã', type: 'rss', url: 'https://en.nhandan.vn/rss/home' },

  // VENEZUELA — teleSUR English
  { country: 'Venezuela', type: 'rss', url: 'https://www.telesurenglish.net/rss/RssHomepage' },

  // LAOS — KPL (scrape)
  { country: 'Laos', type: 'scrape', url: 'https://kpl.gov.la/EN/', pick: { selector: 'a[href*="detail.aspx"]' } }
];
