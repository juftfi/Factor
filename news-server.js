const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const PORT = Number(process.env.NEWS_PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const TAVILY_KEYS = String(process.env.TAVILY_API_KEYS || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
let tavilyKeyIndex = 0;
function getNextTavilyKey() {
  if (!TAVILY_KEYS.length) return '';
  const key = TAVILY_KEYS[tavilyKeyIndex % TAVILY_KEYS.length];
  tavilyKeyIndex++;
  return key;
}

function decodeXmlEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

function parseRssItems(xml, sourceName) {
  const items = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
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

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const recent = all.filter((n) => !n.pubDate || (now - new Date(n.pubDate).getTime()) <= oneDayMs);
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

async function buildReportWithOpenAI(news) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY in .env');
  }
  const condensed = news.map((n, i) => (
    `${i + 1}. [${n.source}] ${n.title} (${n.pubDate || 'no date'})\n${n.link}`
  )).join('\n\n');

  const prompt =
    'You are a crypto analyst. Using the listed news, write a short report in English for TODAY.\n' +
    'Strict format:\n' +
    '- Overall headline (1 line)\n' +
    '- 4-6 bullets with the key developments\n' +
    '- "Probable market impact" in 3 bullets\n' +
    '- "Risks / signals to watch" in 3 bullets\n' +
    '- End with "Sources used today:" listing the URLs.\n';

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content: `News:\n\n${condensed}` },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }
  const data = await response.json();
  return data.output_text || 'Could not generate report.';
}

function sanitizeLiamTweetText(text, fallback = '') {
  const raw = String(text || fallback || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= 260) return raw;
  return `${raw.slice(0, 257).replace(/\s+\S*$/, '')}...`;
}

async function buildLiamTweetsWithOpenAI(items) {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env');
  const sourceItems = (Array.isArray(items) ? items : []).slice(0, 7).map((n) => ({
    source: String(n?.source || 'Crypto Feed'),
    title: String(n?.title || '').trim(),
    summary: String(n?.summary || '').trim(),
    url: String(n?.url || '').trim(),
  })).filter((n) => n.title);
  if (!sourceItems.length) return [];

  const prompt = [
    'You are Liam, a crypto social media writer.',
    'Write one tweet per news item in English.',
    'Do not copy headlines verbatim. Summarize what happened and why it matters.',
    'Tweet style: concise, informative, publication-ready.',
    'Each tweet must be <= 260 characters.',
    'No emojis.',
    'Return strict JSON only:',
    '{"tweets":[{"tweet":"..."}]}',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify({ items: sourceItems }) },
      ],
      temperature: 0.65,
      max_tokens: 700,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI API ${response.status}`);
  }

  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const parsed = parseJsonFromText(content);
  const tweetsRaw = Array.isArray(parsed?.tweets) ? parsed.tweets : [];
  const fallback = sourceItems.map((n) => ({
    tweet: sanitizeLiamTweetText(`${n.summary || n.title} (${n.source})`, n.title),
  }));
  if (!tweetsRaw.length) return fallback;
  return sourceItems.map((n, idx) => ({
    tweet: sanitizeLiamTweetText(
      tweetsRaw[idx]?.tweet,
      `${n.summary || n.title} (${n.source})`
    ),
  }));
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(payload));
}

const ETHAN_INTERVAL = '4h';
const ETHAN_CACHE_TTL_MS = 20_000;
let ethanSnapshotCache = { at: 0, payload: null };

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const TRADTECH_COINS = [
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

async function buildTradeTechMarket(asset, symbol, coinId, binanceSymbol) {
  const warnings = [];
  const binanceSym = binanceSymbol || symbol.replace('/', '');
  try {
    const [series, klines] = await Promise.all([
      fetchTradeTechSeries(coinId),
      fetchBinanceKlines(binanceSym, '1m', 48),
    ]);
    const latest = series[series.length - 1] || {};
    const chartPoints = series.map((row) => row.price).filter((n) => Number.isFinite(n)).slice(-48);
    return {
      asset,
      symbol,
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
      asset,
      symbol,
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

async function fetchBinanceSpotPrice(symbol) {
  const compact = String(symbol || '').replace('/', '');
  const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(compact)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Binance price ${resp.status}`);
  const num = Number(data?.price);
  if (!Number.isFinite(num)) throw new Error('Invalid Binance price payload');
  return num;
}

const COINGECKO_IDS = {
  'BTC/USDT': 'bitcoin',
  'ETH/USDT': 'ethereum',
  'SOL/USDT': 'solana',
};
const COINBASE_PRODUCTS = {
  'BTC/USDT': 'BTC-USD',
  'ETH/USDT': 'ETH-USD',
  'SOL/USDT': 'SOL-USD',
};

async function fetchCoinGeckoSeries(symbol) {
  const coinId = COINGECKO_IDS[String(symbol || '').toUpperCase()];
  if (!coinId) throw new Error(`No CoinGecko mapping for ${symbol}`);
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=14&interval=hourly`;
  const resp = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`CoinGecko ${resp.status}`);
  const hourly = Array.isArray(data?.prices)
    ? data.prices.map((p) => Number(p?.[1])).filter((n) => Number.isFinite(n))
    : [];
  if (!hourly.length) throw new Error('CoinGecko returned no price points');
  const closes4h = [];
  for (let i = 3; i < hourly.length; i += 4) closes4h.push(hourly[i]);
  const closes = closes4h.length >= 35 ? closes4h : hourly;
  return {
    price: hourly[hourly.length - 1],
    closes,
  };
}

async function fetchCoinbaseSeries(symbol, interval = ETHAN_INTERVAL) {
  const product = COINBASE_PRODUCTS[String(symbol || '').toUpperCase()];
  if (!product) throw new Error(`No Coinbase mapping for ${symbol}`);
  const granularity = 3600;
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;
  const resp = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  const data = await resp.json().catch(() => []);
  if (!resp.ok) throw new Error(`Coinbase candles ${resp.status}`);
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) throw new Error('Coinbase returned no candle rows');
  rows.sort((a, b) => Number(a?.[0] || 0) - Number(b?.[0] || 0));
  const hourlyCloses = rows.map((r) => Number(r?.[4])).filter((n) => Number.isFinite(n));
  if (!hourlyCloses.length) throw new Error('Coinbase returned no close prices');
  const closes = interval === '4h'
    ? hourlyCloses.filter((_, i) => i % 4 === 3)
    : hourlyCloses;
  const normalized = closes.length >= 35 ? closes : hourlyCloses;
  return {
    price: hourlyCloses[hourlyCloses.length - 1],
    closes: normalized,
  };
}

async function fetchBinanceCloses(symbol, interval = ETHAN_INTERVAL, limit = 130) {
  const compact = String(symbol || '').replace('/', '');
  const resp = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(compact)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
  );
  const data = await resp.json().catch(() => []);
  if (!resp.ok) throw new Error(`Binance klines ${resp.status}`);
  const closes = Array.isArray(data) ? data.map((k) => Number(k?.[4])).filter((n) => Number.isFinite(n)) : [];
  if (closes.length < 35) throw new Error('Not enough kline data');
  return closes;
}

function calcRsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcEmaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < period) return out;
  const alpha = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let ema = sum / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i += 1) {
    ema = (values[i] - ema) * alpha + ema;
    out[i] = ema;
  }
  return out;
}

function calcMacd(values) {
  const ema12 = calcEmaSeries(values, 12);
  const ema26 = calcEmaSeries(values, 26);
  const macdSeries = values.map((_, i) => (
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : null
  ));
  const compactMacd = macdSeries.filter((v) => Number.isFinite(v));
  if (compactMacd.length < 9) return { macd: null, macdSignal: null, macdHist: null };
  const signalSeries = calcEmaSeries(compactMacd, 9);
  const macd = compactMacd[compactMacd.length - 1];
  const macdSignal = signalSeries[signalSeries.length - 1];
  if (!Number.isFinite(macd) || !Number.isFinite(macdSignal)) {
    return { macd: null, macdSignal: null, macdHist: null };
  }
  return { macd, macdSignal, macdHist: macd - macdSignal };
}

async function buildBinanceDerivedMarket(asset, symbol, interval = ETHAN_INTERVAL) {
  const warnings = [];
  let price = null;
  const rsi = null;
  const macd = null;
  const macdSignal = null;
  const macdHist = null;
  let chartPoints = [];
  let closes = null;

  try {
    price = await fetchBinanceSpotPrice(symbol);
  } catch (err) {
    warnings.push(err.message || 'price unavailable');
  }

  try {
    closes = await fetchBinanceCloses(symbol, interval);
  } catch (err) {
    warnings.push(err.message || 'binance klines unavailable');
  }

  if (!Number.isFinite(price) || !Array.isArray(closes) || closes.length < 35) {
    try {
      const gecko = await fetchCoinGeckoSeries(symbol);
      if (!Number.isFinite(price) && Number.isFinite(gecko.price)) price = gecko.price;
      if ((!Array.isArray(closes) || closes.length < 35) && Array.isArray(gecko.closes)) {
        closes = gecko.closes;
      }
    } catch (err) {
      warnings.push(err.message || 'coingecko fallback unavailable');
    }
  }

  if (!Number.isFinite(price) || !Array.isArray(closes) || closes.length < 35) {
    try {
      const coinbase = await fetchCoinbaseSeries(symbol, interval);
      if (!Number.isFinite(price) && Number.isFinite(coinbase.price)) price = coinbase.price;
      if ((!Array.isArray(closes) || closes.length < 35) && Array.isArray(coinbase.closes)) {
        closes = coinbase.closes;
      }
    } catch (err) {
      warnings.push(err.message || 'coinbase fallback unavailable');
    }
  }

  if (Array.isArray(closes) && closes.length >= 35) chartPoints = closes.slice(-48);

  return { asset, symbol, price, rsi, macd, macdSignal, macdHist, chartPoints, warnings };
}

async function getEthanMarketSnapshot(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && ethanSnapshotCache.payload && (now - ethanSnapshotCache.at) < ETHAN_CACHE_TTL_MS) {
    return ethanSnapshotCache.payload;
  }

  const markets = await Promise.all(
    TRADTECH_COINS.map((coin) => buildTradeTechMarket(coin.asset, coin.symbol, coin.coinId, coin.binanceSymbol))
  );
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
  } catch (err) {
    markets.forEach((m) => m.warnings.push('News impact analysis unavailable'));
  }
  const payload = { ok: true, interval: ETHAN_INTERVAL, markets };
  ethanSnapshotCache = { at: now, payload };
  return payload;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk || '');
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        if (!raw.trim()) resolve({});
        else resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/noah-crypto-report') {
    try {
      const news = await fetchCryptoNews();
      if (!news.length) {
        writeJson(res, 200, { report: 'Not enough recent crypto stories were found in public feeds today.' });
        return;
      }
      const report = await buildReportWithOpenAI(news);
      writeJson(res, 200, { report, newsCount: news.length });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/liam-tweets') {
    try {
      const body = await readJsonBody(req);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) {
        writeJson(res, 400, { error: 'items array is required' });
        return;
      }
      const tweets = await buildLiamTweetsWithOpenAI(items);
      writeJson(res, 200, { ok: true, tweets });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/worker-chat-reply') {
    try {
      if (!OPENAI_API_KEY) {
        writeJson(res, 500, { error: 'Missing OPENAI_API_KEY in .env' });
        return;
      }
      const body = await readJsonBody(req);
      const worker = String(body.worker || '').trim();
      const incomingText = String(body.incomingText || '').trim();
      const incomingName = String(body.incomingName || 'Guest').trim();
      if (!worker || !incomingText) {
        writeJson(res, 400, { error: 'worker and incomingText are required' });
        return;
      }

      const persona = {
        Noah: 'You are Noah, crypto analyst of the office. You give brief, insightful crypto updates.',
        Liam: 'You are Liam, social media specialist. You help with X/Twitter posts and content ideas.',
        Olivia: 'You are Olivia, custom agent. You run tasks based on user instructions.',
        Emma: 'You are Emma, Base chain wallet specialist. You help with wallet and account actions.',
        Ethan: 'You are Ethan, operations and market helper. You assist with decisions and keep things running.',
      }[worker] || `You are ${worker}, an office assistant.`;

      const systemPrompt = [
        persona,
        'Reply naturally and helpfully, as the character would in a chat. Be concise (1-2 sentences).',
        'Do not use emojis. Do not say generic phrases like "I saw your mention."',
        `You are replying in a public global chat to ${incomingName}.`,
      ].join('\n');
      const userPrompt = `Message mentioning you: "${incomingText}"\nRespond as ${worker}.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 120,
          temperature: 0.7,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        writeJson(res, response.status, {
          error: data?.error?.message || `OpenAI API ${response.status}`,
        });
        return;
      }
      const answer = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!answer) {
        writeJson(res, 500, { error: 'Empty response from OpenAI', answer: '' });
        return;
      }
      writeJson(res, 200, { ok: true, answer });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ethan-news') {
    try {
      const body = await readJsonBody(req);
      const markets = Array.isArray(body?.markets) ? body.markets : [];
      if (!markets.length) {
        writeJson(res, 400, { error: 'markets array required' });
        return;
      }
      const news = await fetchCryptoNews();
      const impacts = await assessNewsImpactForMarkets(markets, news);
      writeJson(res, 200, { ok: true, impacts });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/olivia-fourmeme') {
    try {
      const body = await readJsonBody(req);
      const action = String(body?.action || '').trim();
      let fourMemeUrl = '';
      let fourMemeBody = null;
      let method = 'POST';

      if (action === 'rankings') {
        fourMemeUrl = 'https://four.meme/meme-api/v1/public/token/ranking';
        fourMemeBody = {
          type: String(body.type || 'HOT'),
          pageSize: Number(body.pageSize || 20),
          ...(body.symbol ? { symbol: body.symbol } : {}),
        };
      } else if (action === 'search') {
        fourMemeUrl = 'https://four.meme/meme-api/v1/public/token/search';
        fourMemeBody = {
          type: String(body.type || 'HOT'),
          listType: 'NOR',
          pageIndex: 1,
          pageSize: Number(body.pageSize || 20),
          status: 'ALL',
          sort: 'DESC',
          ...(body.keyword ? { keyword: body.keyword } : {}),
        };
      } else if (action === 'auth-nonce') {
        fourMemeUrl = 'https://four.meme/meme-api/v1/private/user/nonce/generate';
        fourMemeBody = {
          accountAddress: String(body.address || '').trim(),
          verifyType: 'LOGIN',
          networkCode: 'BSC',
        };
      } else if (action === 'auth-login') {
        fourMemeUrl = 'https://four.meme/meme-api/v1/private/user/login/dex';
        fourMemeBody = {
          region: 'WEB',
          langType: 'EN',
          loginIp: '',
          inviteCode: '',
          verifyInfo: {
            address: String(body.wallet || '').trim(),
            networkCode: 'BSC',
            signature: String(body.signature || '').trim(),
            verifyType: 'LOGIN',
          },
          walletName: 'MetaMask',
        };
      } else if (action === 'upload-image') {
        // Proxy: download image from URL and upload to four.meme CDN
        const imgUrlSrc = String(body.imageUrl || '').trim();
        const accessToken0 = String(body.accessToken || '').trim();
        if (!imgUrlSrc || !accessToken0) { writeJson(res, 400, { error: 'imageUrl and accessToken required' }); return; }
        const imgResp = await fetch(imgUrlSrc);
        if (!imgResp.ok) { writeJson(res, 400, { error: 'Could not fetch image: ' + imgResp.status }); return; }
        const imgBuf = await imgResp.arrayBuffer();
        const ct = imgResp.headers.get('content-type') || 'image/jpeg';
        const ext = ct.includes('png') ? 'image.png' : ct.includes('gif') ? 'image.gif' : ct.includes('webp') ? 'image.webp' : 'image.jpg';
        const form = new FormData();
        form.append('file', new Blob([imgBuf], { type: ct }), ext);
        const uploadResp = await fetch('https://four.meme/meme-api/v1/private/token/upload', {
          method: 'POST',
          headers: { 'meme-web-access': accessToken0, 'origin': 'https://four.meme', 'referer': 'https://four.meme/' },
          body: form,
        });
        const uploadData = await uploadResp.json().catch(() => ({}));
        writeJson(res, 200, { ok: true, data: uploadData });
        return;
      } else if (action === 'create-token-api') {
        fourMemeUrl = 'https://four.meme/meme-api/v1/private/token/create';
        const accessToken = String(body.accessToken || '').trim();
        // Fetch public config to get raisedToken info
        let raisedToken = { symbol: 'BNB', totalBAmount: '18', totalAmount: '1000000000', saleRate: '0.8', status: 'PUBLISH' };
        try {
          const cfgRes = await fetch('https://four.meme/meme-api/v1/public/config');
          const cfgData = await cfgRes.json().catch(() => ({}));
          if (cfgData.code === 0 && Array.isArray(cfgData.data) && cfgData.data.length > 0) {
            const published = cfgData.data.filter(c => c.status === 'PUBLISH');
            const list = published.length > 0 ? published : cfgData.data;
            raisedToken = list.find(c => c.symbol === 'BNB') || list[0];
          }
        } catch (_) {}
        const validLabels = ['Meme','AI','Defi','Games','Infra','De-Sci','Social','Depin','Charity','Others'];
        const rawLabel = String(body.label || 'Meme');
        const labelCanonical = validLabels.find(l => l.toLowerCase() === rawLabel.toLowerCase()) || 'Meme';
        fourMemeBody = {
          name: body.name,
          shortName: body.symbol,
          desc: body.description,
          totalSupply: Number(raisedToken.totalAmount || 1000000000),
          raisedAmount: Number(raisedToken.totalBAmount || 18),
          saleRate: Number(raisedToken.saleRate || 0.8),
          reserveRate: 0,
          imgUrl: body.imageUrl,
          raisedToken,
          launchTime: Date.now(),
          funGroup: false,
          label: labelCanonical,
          lpTradingFee: 0.0025,
          preSale: String(body.devBuyBNB || '0'),
          clickFun: false,
          symbol: raisedToken.symbol,
          dexType: 'PANCAKE_SWAP',
          rushMode: false,
          onlyMPC: false,
          feePlan: false,
          ...(body.webUrl ? { webUrl: body.webUrl } : {}),
          ...(body.twitterUrl ? { twitterUrl: body.twitterUrl } : {}),
          ...(body.telegramUrl ? { telegramUrl: body.telegramUrl } : {}),
        };
        const fetchOpts2 = { method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json', 'meme-web-access': accessToken, 'origin': 'https://four.meme', 'referer': 'https://four.meme/' }, body: JSON.stringify(fourMemeBody) };
        const resp2 = await fetch(fourMemeUrl, fetchOpts2);
        const data2 = await resp2.json().catch(() => ({}));
        writeJson(res, 200, { ok: true, data: data2 });
        return;
      } else if (action === 'token-info') {
        const addr = String(body.address || '').trim();
        if (!addr) { writeJson(res, 400, { error: 'address required' }); return; }
        fourMemeUrl = 'https://four.meme/meme-api/v1/private/token/get/v2?address=' + encodeURIComponent(addr);
        method = 'GET';
      } else {
        writeJson(res, 400, { error: 'Unknown action: ' + action });
        return;
      }

      const fetchOpts = {
        method,
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'origin': 'https://four.meme', 'referer': 'https://four.meme/' },
      };
      if (method === 'POST' && fourMemeBody) fetchOpts.body = JSON.stringify(fourMemeBody);
      const resp = await fetch(fourMemeUrl, fetchOpts);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { writeJson(res, resp.status, { error: data?.message || data?.msg || 'four.meme error' }); return; }
      writeJson(res, 200, { ok: true, data });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/researcher-search') {
    try {
      const body = await readJsonBody(req);
      const query = String(body?.query || '').trim();
      if (!query) {
        writeJson(res, 400, { error: 'query is required' });
        return;
      }
      if (!TAVILY_KEYS.length) {
        writeJson(res, 500, { error: 'Missing TAVILY_API_KEYS in environment' });
        return;
      }
      let lastErr = null;
      for (let attempt = 0; attempt < TAVILY_KEYS.length; attempt++) {
        const apiKey = getNextTavilyKey();
        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 6, include_answer: true }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            lastErr = data?.detail || data?.message || `Tavily ${resp.status}`;
            continue;
          }
          writeJson(res, 200, { ok: true, answer: data.answer || null, results: Array.isArray(data.results) ? data.results : [] });
          return;
        } catch (err) {
          lastErr = err.message;
        }
      }
      writeJson(res, 500, { error: lastErr || 'All Tavily keys failed' });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/emma-skills') {
    try {
      const apiKey = String(OPENAI_API_KEY || '').trim();
      if (!apiKey) {
        writeJson(res, 500, { error: 'Missing OPENAI_API_KEY in .env' });
        return;
      }
      const body = await readJsonBody(req);
      const query = String(body.query || '').trim();
      const skillsContext = String(body.skillsContext || '').trim();
      if (!query) {
        writeJson(res, 400, { error: 'query is required' });
        return;
      }
      const systemPrompt = [
        'You are Emma, a Web3 Product Manager expert in the Pieverse skill marketplace on BNB Chain.',
        'Your job is to recommend the best Pieverse skills for what the user wants to build.',
        'Be specific: name each skill, explain why it fits, how skills work together, and what the integration looks like.',
        'Return strict JSON only with this shape:',
        '{"answer":"short explanation for the user","recommendations":[{"skillName":"exact skill name from catalog","why":"why this skill is useful"}]}',
        'Pick 3 to 6 skills maximum.',
        'Never make up skills that are not in the provided catalog.',
        '',
        'Available Pieverse skills catalog:',
        skillsContext,
      ].filter(Boolean).join('\n');
      const dsResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });
      const data = await dsResp.json();
      if (!dsResp.ok) {
        writeJson(res, dsResp.status, { error: data?.error?.message || `DeepSeek API ${dsResp.status}` });
        return;
      }
      const raw = String(data?.choices?.[0]?.message?.content || '').trim();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch (_) {}
        }
      }
      const answer = String(parsed?.answer || raw || 'No response.').trim();
      const recommendations = Array.isArray(parsed?.recommendations)
        ? parsed.recommendations
            .map((r) => ({
              skillName: String(r?.skillName || '').trim(),
              why: String(r?.why || '').trim(),
            }))
            .filter((r) => r.skillName)
        : [];
      writeJson(res, 200, { ok: true, answer, recommendations });
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'GET' && (req.url.startsWith('/api/ethan-market-snapshot') || req.url.startsWith('/api/ethan-market'))) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
      const payload = await getEthanMarketSnapshot(forceRefresh);
      writeJson(res, 200, payload);
    } catch (err) {
      writeJson(res, 500, { error: err.message || 'Internal error' });
    }
    return;
  }

  if (req.method === 'GET') {
    let safePath = (req.url === '/' ? '/index.html' : req.url).split('?')[0].replace(/\.\./g, '');
    const filePath = path.resolve(path.join(process.cwd(), safePath.replace(/^\//, '')));
    if (!filePath.startsWith(process.cwd())) {
      writeJson(res, 403, { error: 'Forbidden' });
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      if (ext === '.html' && (safePath === '/' || safePath.endsWith('index.html'))) {
        let html = fs.readFileSync(filePath, 'utf8');
        const inject = `<script>window.OPENAI_API_KEY=${JSON.stringify(OPENAI_API_KEY || '')};<\/script>`;
        if (!html.includes('window.OPENAI_API_KEY')) {
          html = html.replace('</head>', inject + '\n</head>');
        }
        res.writeHead(200, {
          'content-type': 'text/html',
          'access-control-allow-origin': '*',
        });
        res.end(html);
        return;
      }
      res.writeHead(200, {
        'content-type': types[ext] || 'application/octet-stream',
        'access-control-allow-origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  writeJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Noah news server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Open the app at: http://localhost:${PORT}`);
});
