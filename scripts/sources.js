export default [
  // CHINA — RSS estável do China Daily (se quiser, depois somamos Xinhua/CGTN)
  { country: 'China', type: 'rss', url: 'http://www.chinadaily.com.cn/rss/china_rss.xml' },

  // RÚSSIA — The Moscow Times (funcionou no seu JSON)
  { country: 'Rússia', type: 'rss', url: 'https://www.themoscowtimes.com/rss/news' },

  // ÍNDIA — NewsClick (RSS estável)
  { country: 'Índia (análises Sul-Sul)', type: 'rss', url: 'https://www.newsclick.in/rss-feed' },

  // LAOS — KPL (home com links diretos; mantemos por enquanto)
  { country: 'Laos', type: 'scrape', url: 'https://kpl.gov.la/EN/', pick: { selector: 'a[href*="detail.aspx"]' } }

  // CUBA
  { country: 'Cuba', type: 'rss', url: 'https://www.prensa-latina.cu/feed' },

  // VIETNÃ
  { country: 'Vietnã', type: 'rss', url: 'https://en.nhandan.vn/rss/home' },

  // VENEZUELA
  { country: 'Venezuela', type: 'rss', url: 'https://www.telesurenglish.net/rss/RssHomepage' },
];
