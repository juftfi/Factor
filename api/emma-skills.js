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
    if (!apiKey) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY in environment' });
      return;
    }

    const payload = req.body || {};
    const query = String(payload.query || '').trim();
    const skillsContext = String(payload.skillsContext || '').trim();
    if (!query) {
      res.status(400).json({ error: 'query is required' });
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
        model: 'gpt-4.1-mini',
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
      res.status(dsResp.status).json({
        error: data?.error?.message || `DeepSeek API ${dsResp.status}`,
      });
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
    res.status(200).json({ ok: true, answer, recommendations });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
