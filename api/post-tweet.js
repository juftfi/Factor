const crypto = require('crypto');

function pctEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(method, url, body, creds) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_token: creds.accessToken,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_version: '1.0',
  };

  const allParams = { ...oauth, ...body };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    pctEncode(url),
    pctEncode(paramString),
  ].join('&');

  const signingKey = `${pctEncode(creds.apiSecret)}&${pctEncode(creds.accessTokenSecret)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  const headerParams = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(headerParams)
    .sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(headerParams[k])}"`)
    .join(', ')}`;
}

async function postTweetOAuth1(text, creds) {
  const endpoint = 'https://api.twitter.com/1.1/statuses/update.json';
  const body = { status: text };
  const auth = buildOAuthHeader('POST', endpoint, body, creds);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: auth,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: `status=${pctEncode(text)}`,
  });
  const out = await res.text();
  if (!res.ok) {
    const err = new Error(`Twitter API ${res.status}`);
    err.status = res.status;
    err.details = out;
    throw err;
  }
  return out ? JSON.parse(out) : { ok: true };
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
    const payload = req.body || {};
    const text = String(payload.text || '').trim();
    if (!text) {
      res.status(400).json({ error: 'Missing tweet text' });
      return;
    }

    // Prefer explicit payload values; fallback to env secrets.
    const creds = {
      apiKey: payload.apiKey || process.env.TWITTER_API_KEY,
      apiSecret: payload.apiSecret || process.env.TWITTER_API_SECRET,
      accessToken: payload.accessToken || process.env.TWITTER_ACCESS_TOKEN,
      accessTokenSecret: payload.accessTokenSecret || process.env.TWITTER_ACCESS_TOKEN_SECRET,
    };

    if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
      res.status(400).json({
        error: 'Missing credentials. Need API key/secret + access token/secret.',
      });
      return;
    }

    const result = await postTweetOAuth1(text.slice(0, 280), creds);
    res.status(200).json({ ok: true, result });
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal error',
      details: err.details || null,
    });
  }
};
