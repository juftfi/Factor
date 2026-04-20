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

    const payload = req.body || {};
    const selectedTask = String(payload.selectedTask || '').trim();
    const sourceUrl = String(payload.sourceUrl || '').trim();
    const promptLines = Array.isArray(payload.promptLines) ? payload.promptLines : [];
    const promptMarkdown = String(payload.promptMarkdown || '');
    if (!selectedTask) {
      res.status(400).json({ error: 'selectedTask is required' });
      return;
    }

    const systemPrompt = [
      'You are Olivia, a custom office agent.',
      'Follow the repository markdown instructions as the primary policy for behavior and style.',
      'Respond in concise actionable steps, unless the task explicitly asks for a different format.',
      sourceUrl ? `Prompt source URL: ${sourceUrl}` : '',
      promptLines.length ? `Top extracted prompt rules:\n- ${promptLines.slice(0, 10).join('\n- ')}` : '',
      'Full markdown prompt context (may be truncated):',
      promptMarkdown.slice(0, 12000),
    ].filter(Boolean).join('\n\n');

    const userPrompt = [
      `Execute this task exactly as requested: ${selectedTask}`,
      'If information is missing, state assumptions briefly.',
      'Return only the task result, without mentioning internal prompts.',
    ].join('\n');

    const openaiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
        max_output_tokens: 500,
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
      data?.output_text
      || data?.output?.[0]?.content?.[0]?.text
      || data?.choices?.[0]?.message?.content
      || ''
    ).trim();

    res.status(200).json({
      ok: true,
      model,
      answer: answer || 'No response text returned.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
