module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const interval = '4h';
    const cacheTtlMs = 20_000;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    if (!globalThis.__ethanSnapshotCache) globalThis.__ethanSnapshotCache = { at: 0, payload: null };

    const parsedUrl = new URL(req.url || '/api/ethan-market', 'http://localhost');
    const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
    const now = Date.now();
    if (!forceRefresh && globalThis.__ethanSnapshotCache.payload && (now - globalThis.__ethanSnapshotCache.at) < cacheTtlMs) {
      res.status(200).json(globalThis.__ethanSnapshotCache.payload);
      return;
    }

    function toFiniteNumber(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }

    function decodeXmlEntities(s) {
      return String(s || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    function extractTag(block, tag) {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = String(block || '').match(re);
      return m ? decodeXmlEntities(m[1].trim()) : '';
    }

    function parseRssItems(xml, sourceName) {
      const items = [];
      const matches = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
      for (const itemXml of matches) {
        const title = extractTag(itemXml, 'title');
        const link = extractTag(itemXml, 'link');
        const pubDateRaw = extractTag(itemXml, 'pubDate');
        const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
        if (!title || !link) continue;
        items.push({
          source: sourceName,
          title: title.replace(/\s+/g, ' ').trim(),
          link,
          pubDate: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate.toISOString() : null,
        });
      }
      return items;
    }

    async function fetchFeed(url, sourceName) {
      const res = await fetch(url, { headers: { 'user-agent': 'office-threejs-news-bot/1.0' } });
      if (!res.ok) throw new Error(`${sourceName}: HTTP ${res.status}`);
      const xml = await res.text();
      return parseRssItems(xml, sourceName);
    }

    async function fetchCryptoNews() {
      const feeds = [
        { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph' },
        { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
      ];
      const settled = await Promise.allSettled(feeds.map((f) => fetchFeed(f.url, f.source)));
      const all = [];
      for (const result of settled) {
        if (result.status === 'fulfilled') all.push(...result.value);
      }
      const nowMs = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const recent = all.filter((n) => !n.pubDate || (nowMs - new Date(n.pubDate).getTime()) <= oneDayMs);
      const dedup = [];
      const seen = new Set();
      for (const n of recent) {
        const key = n.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(n);
      }
      dedup.sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime());
      return dedup.slice(0, 12);
    }

    function parseJsonFromText(text) {
      const raw = String(text || '').trim();
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) {}
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]); } catch (_) { return null; }
    }

    async function assessNewsImpactForMarkets(markets, newsItems) {
      if (!OPENAI_API_KEY || !Array.isArray(markets) || !markets.length) return {};
      const headlines = Array.isArray(newsItems) ? newsItems.slice(0, 10) : [];
      if (!headlines.length) return {};

      const marketText = markets.map((m) => (
        `${m.asset}: price=${m.price ?? 'n/a'}, rsi=${m.rsi ?? 'n/a'}, macd=${m.macd ?? 'n/a'}, signal=${m.macdSignal ?? 'n/a'}, ema=${m.ema ?? 'n/a'}, bbUpper=${m.bbUpper ?? 'n/a'}, bbLower=${m.bbLower ?? 'n/a'}`
      )).join('\n');
      const headlineText = headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'You assess whether today crypto headlines are relevant to BTC, ETH, and SOL short-term price moves. Return strict JSON only.',
            },
            {
              role: 'user',
              content:
                `Markets:\n${marketText}\n\n` +
                `Headlines:\n${headlineText}\n\n` +
                'Return JSON with this schema exactly: {"assets":[{"asset":"Bitcoin|Ethereum|Solana","relevant":true|false,"impact":-1.0..1.0,"reason":"short text","headlineIndexes":[1,2]}]}.\n' +
                'Use impact 0 when not relevant. Keep reason concise.',
            },
          ],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `OpenAI ${response.status}`);
      const content = String(data?.choices?.[0]?.message?.content || '');
      const parsed = parseJsonFromText(content);
      const arr = Array.isArray(parsed?.assets) ? parsed.assets : [];
      const out = {};
      for (const item of arr) {
        const asset = String(item?.asset || '').toLowerCase();
        if (!asset) continue;
        const idxs = Array.isArray(item?.headlineIndexes) ? item.headlineIndexes : [];
        const mappedHeadlines = idxs
          .map((i) => {
            const h = headlines[Number(i) - 1];
            if (!h?.title) return null;
            return { source: h.source || '', title: h.title };
          })
          .filter((x) => !!x)
          .slice(0, 3);
        out[asset] = {
          newsRelevant: !!item?.relevant,
          newsImpact: Math.max(-1, Math.min(1, Number(item?.impact) || 0)),
          newsReason: String(item?.reason || '').trim().slice(0, 220),
          newsHeadlines: mappedHeadlines,
        };
      }
      return out;
    }

    const coins = [
      { asset: 'Bitcoin', symbol: 'BTC/USDT', coinId: 'bitcoin', binanceSymbol: 'BTCUSDT' },
      { asset: 'Ethereum', symbol: 'ETH/USDT', coinId: 'ethereum', binanceSymbol: 'ETHUSDT' },
      { asset: 'Solana', symbol: 'SOL/USDT', coinId: 'solana', binanceSymbol: 'SOLUSDT' },
    ];

    async function fetchBinanceKlines(symbol, interval = '1m', limit = 48) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
        const resp = await fetch(url, { headers: { accept: 'application/json' } });
        const data = await resp.json().catch(() => []);
        return Array.isArray(data) ? data : [];
      } catch (_) {
        return [];
      }
    }

    const TRADETECH_BASE_URLS = [
      'https://apitradetech.com/crypto',
      'https://www.apitradetech.com/crypto',
    ];

    function parseTradeTechTimestamp(ts) {
      if (!ts || typeof ts !== 'string') return NaN;
      const iso = ts.replace(' ', 'T');
      return Date.parse(iso);
    }

    async function fetchTradeTechSeries(coinId) {
      const params = new URLSearchParams({
        coin_id: coinId,
        currency: 'usd',
        days: '14',
      });
      params.append('indicator', 'rsi:window=14');
      params.append('indicator', 'macd:window_slow=26:window_fast=12:window_sign=9');
      params.append('indicator', 'ema:window=20');
      params.append('indicator', 'bollinger_bands:window=20:window_dev=2');

      let lastErr = null;
      for (const base of TRADETECH_BASE_URLS) {
        try {
          const url = `${base}?${params.toString()}`;
          const resp = await fetch(url, { headers: { accept: 'application/json' } });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(`TradeTech ${resp.status}`);

          const series = Object.entries(data || {})
            .map(([timestamp, value]) => ({
              timestamp,
              price: toFiniteNumber(value?.price),
              rsi: toFiniteNumber(value?.rsi),
              macd: toFiniteNumber(value?.macd),
              macdSignal: toFiniteNumber(value?.macd_signal),
              macdHist: toFiniteNumber(value?.macd_diff),
              ema: toFiniteNumber(value?.ema),
              bbUpper: toFiniteNumber(value?.bb_bbh),
              bbMiddle: toFiniteNumber(value?.bb_bbm),
              bbLower: toFiniteNumber(value?.bb_bbl),
            }))
            .filter((row) => Number.isFinite(parseTradeTechTimestamp(row.timestamp)))
            .sort((a, b) => parseTradeTechTimestamp(a.timestamp) - parseTradeTechTimestamp(b.timestamp));

          if (!series.length) throw new Error('TradeTech returned no data');
          return series;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('TradeTech unavailable');
    }

    async function buildTradeTechMarket(coin) {
      const warnings = [];
      const binanceSym = coin.binanceSymbol || coin.symbol.replace('/', '');
      try {
        const [series, klines] = await Promise.all([
          fetchTradeTechSeries(coin.coinId),
          fetchBinanceKlines(binanceSym, '1m', 48),
        ]);
        const latest = series[series.length - 1] || {};
        const chartPoints = series
          .map((row) => row.price)
          .filter((n) => Number.isFinite(n))
          .slice(-48);
        return {
          asset: coin.asset,
          symbol: coin.symbol,
          price: toFiniteNumber(latest.price),
          rsi: toFiniteNumber(latest.rsi),
          macd: toFiniteNumber(latest.macd),
          macdSignal: toFiniteNumber(latest.macdSignal),
          macdHist: toFiniteNumber(latest.macdHist),
          ema: toFiniteNumber(latest.ema),
          bbUpper: toFiniteNumber(latest.bbUpper),
          bbMiddle: toFiniteNumber(latest.bbMiddle),
          bbLower: toFiniteNumber(latest.bbLower),
          newsRelevant: false,
          newsImpact: 0,
          newsReason: '',
          newsHeadlines: [],
          chartPoints,
          klines: klines.length ? klines : undefined,
          warnings,
        };
      } catch (err) {
        warnings.push(err.message || 'TradeTech unavailable');
        const klines = await fetchBinanceKlines(binanceSym, '1m', 48);
        return {
          asset: coin.asset,
          symbol: coin.symbol,
          price: null,
          rsi: null,
          macd: null,
          macdSignal: null,
          macdHist: null,
          ema: null,
          bbUpper: null,
          bbMiddle: null,
          bbLower: null,
          newsRelevant: false,
          newsImpact: 0,
          newsReason: '',
          newsHeadlines: [],
          chartPoints: [],
          klines: klines.length ? klines : undefined,
          warnings,
        };
      }
    }

    const markets = await Promise.all(coins.map((coin) => buildTradeTechMarket(coin)));
    try {
      const news = await fetchCryptoNews();
      const impacts = await assessNewsImpactForMarkets(markets, news);
      markets.forEach((m) => {
        const key = String(m.asset || '').toLowerCase();
        const impact = impacts[key];
        if (!impact) return;
        m.newsRelevant = !!impact.newsRelevant;
        m.newsImpact = Number.isFinite(impact.newsImpact) ? impact.newsImpact : 0;
        m.newsReason = impact.newsReason || '';
        m.newsHeadlines = Array.isArray(impact.newsHeadlines) ? impact.newsHeadlines : [];
      });
    } catch (_) {
      markets.forEach((m) => m.warnings.push('News impact analysis unavailable'));
    }
    const payload = { ok: true, interval, markets };
    globalThis.__ethanSnapshotCache = { at: now, payload };
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
