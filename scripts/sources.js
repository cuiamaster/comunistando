// scripts/sources.js
// Fontes estáveis por país (até 3 notícias por feed via aggregator)

export default [
  // CHINA — China Daily (RSS oficial e estável)
  { country: 'China', type: 'rss', url: 'http://www.chinadaily.com.cn/rss/china_rss.xml' },

  // RÚSSIA — The Moscow Times (funcionou no seu JSON)
  { country: 'Rússia', type: 'rss', url: 'https://www.themoscowtimes.com/rss/news' },

  // ÍNDIA — NewsClick (RSS)
  { country: 'Índia (análises Sul-Sul)', type: 'rss', url: 'https://www.newsclick.in/rss-feed' },

  // CUBA — Prensa Latina (RSS geral)
  { country: 'Cuba', type: 'rss', url: 'https://www.prensa-latina.cu/feed' },

  // VIETNÃ — Nhan Dan (RSS home, estável)
  { country: 'Vietnã', type: 'rss', url: 'https://en.nhandan.vn/rss/home' },

  // VENEZUELA — teleSUR English (RSS)
  { country: 'Venezuela', type: 'rss', url: 'https://www.telesurenglish.net/rss/RssHomepage' },

  // LAOS — KPL (sem RSS; pega a 1ª matéria da home)
  { country: 'Laos', type: 'scrape', url: 'https://kpl.gov.la/EN/', pick: { selector: 'a[href*="detail.aspx"]' } }
];
