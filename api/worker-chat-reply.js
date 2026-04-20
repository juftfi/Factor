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
    const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    if (!apiKey) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY in environment' });
      return;
    }

    const body = req.body || {};
    const worker = String(body.worker || '').trim();
    const incomingText = String(body.incomingText || '').trim();
    const incomingName = String(body.incomingName || 'Guest').trim();
    if (!worker || !incomingText) {
      res.status(400).json({ error: 'worker and incomingText are required' });
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
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 120,
        temperature: 0.7,
      }),
    });
    const data = await openaiResp.json();
    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({
        error: data?.error?.message || `OpenAI API ${openaiResp.status}`,
      });
      return;
    }

    const answer = String(
      data?.choices?.[0]?.message?.content
      || data?.output_text
      || data?.output?.[0]?.content?.[0]?.text
      || ''
    ).trim();

    if (!answer) {
      res.status(500).json({ error: 'Empty response from OpenAI', answer: '' });
      return;
    }

    res.status(200).json({ ok: true, answer, model });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
