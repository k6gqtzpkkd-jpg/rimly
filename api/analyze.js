const { generateWithAvailableProvider } = require('./ai-providers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { matchData } = req.body;
    if (!matchData) {
      return res.status(400).json({ error: 'Missing match data' });
    }

    const prompt = `
あなたはプロのバスケットボールアナリストです。
以下の試合データから、この試合の評価、キープレーヤー、勝敗を分けたポイントを分析して出力してください。
出力はHTML形式で、<p>、<ul>、<li>、<strong>等のタグを使って整形してください。
HTMLの<body>タグや<html>タグ、Markdownのコードブロックは含めないでください。

【試合データ】
${JSON.stringify(matchData, null, 2)}
`;

    const result = await generateWithAvailableProvider({ prompt });
    const analysis = result.text.replace(/^```html\n?/, '').replace(/^```\n?/, '').replace(/```\n?$/, '');
    return res.status(200).json({
      analysis,
      provider: result.provider,
      model: result.model
    });
  } catch (error) {
    console.error('Analyze Error Details:', error);
    let details = error.message || 'Unknown error';
    if (details.includes('API_KEY_INVALID')) details = 'APIキーが無効です。';
    return res.status(500).json({
      error: 'Failed to process AI analysis',
      details
    });
  }
};
