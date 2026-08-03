function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

function sanitizeLiamTweetText(text, fallback = '') {
  const raw = String(text || fallback || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= 260) return raw;
  return `${raw.slice(0, 257).replace(/\s+\S*$/, '')}...`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    const model = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
    if (!apiKey) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY in environment' });
      return;
    }

    const body = req.body || {};
    const sourceItems = (Array.isArray(body?.items) ? body.items : [])
      .slice(0, 7)
      .map((n) => ({
        source: String(n?.source || 'Crypto Feed'),
        title: String(n?.title || '').trim(),
        summary: String(n?.summary || '').trim(),
        url: String(n?.url || '').trim(),
      }))
      .filter((n) => n.title);

    if (!sourceItems.length) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }

    const systemPrompt = [
      'You are Liam, a crypto social media writer.',
      'Write one tweet per news item in English.',
      'Do not copy headlines verbatim. Summarize what happened and why it matters.',
      'Tweet style: concise, informative, publication-ready.',
      'Each tweet must be <= 260 characters.',
      'No emojis.',
      'Return strict JSON only:',
      '{"tweets":[{"tweet":"..."}]}',
    ].join('\n');

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ items: sourceItems }) },
        ],
        temperature: 0.65,
        max_tokens: 700,
      }),
    });
    const data = await openaiResp.json().catch(() => ({}));
    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({
        error: data?.error?.message || `OpenAI API ${openaiResp.status}`,
      });
      return;
    }

    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    const parsed = parseJsonFromText(content);
    const tweetsRaw = Array.isArray(parsed?.tweets) ? parsed.tweets : [];
    const tweets = sourceItems.map((n, idx) => ({
      tweet: sanitizeLiamTweetText(
        tweetsRaw[idx]?.tweet,
        `${n.summary || n.title} (${n.source})`
      ),
    }));

    res.status(200).json({ ok: true, tweets, model });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
