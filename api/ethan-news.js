module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = typeof body === 'object' && body ? body : {};
    const markets = Array.isArray(body?.markets) ? body.markets : [];

    if (!markets.length) {
      res.status(400).json({ error: 'markets array required' });
      return;
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
      const r = await fetch(url, { headers: { 'user-agent': 'office-threejs-news-bot/1.0' } });
      if (!r.ok) throw new Error(`${sourceName}: HTTP ${r.status}`);
      return parseRssItems(await r.text(), sourceName);
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
    async function assessNewsImpactForMarkets(mkts, newsItems) {
      if (!OPENAI_API_KEY || !Array.isArray(mkts) || !mkts.length) return {};
      const headlines = Array.isArray(newsItems) ? newsItems.slice(0, 10) : [];
      if (!headlines.length) return {};
      const marketText = mkts.map((m) => (
        `${m.asset}: price=${m.price ?? 'n/a'}, rsi=${m.rsi ?? 'n/a'}, macd=${m.macd ?? 'n/a'}, ema=${m.ema ?? 'n/a'}`
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
                `Markets:\n${marketText}\n\nHeadlines:\n${headlineText}\n\n` +
                'Return JSON: {"assets":[{"asset":"Bitcoin|Ethereum|Solana","relevant":true|false,"impact":-1.0..1.0,"reason":"short text","headlineIndexes":[1,2]}]}. Use impact 0 when not relevant.',
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

    const news = await fetchCryptoNews();
    const impacts = await assessNewsImpactForMarkets(markets, news);
    res.status(200).json({ ok: true, impacts });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
