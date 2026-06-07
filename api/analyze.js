const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY not set in environment' });
  }

  try {
    const { matchData } = req.body;
    if (!matchData) {
      return res.status(400).json({ error: 'Missing match data' });
    }

    // 高速化のためモデルリストの動的取得を廃止し、gemini-1.5-flashを直指定
    const selectedModelId = "gemini-1.5-flash";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: selectedModelId });

    const prompt = `
      あなたはプロのバスケットボールアナリストです。
      以下の試合データから、この試合の評価、キープレーヤー、勝敗を分けたポイントを分析して出力してください。
      出力はHTML形式で、<p>、<ul>、<li>、<strong>等のタグを使って美しく整形して返してください。
      HTMLの<body>タグや<html>タグ、Markdownのコードブロック( \`\`\`html など )は含めないでください。

      【試合データ】
      ${JSON.stringify(matchData, null, 2)}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text.replace(/^```html\n?/, '').replace(/^```\n?/, '').replace(/```\n?$/, '');

    return res.status(200).json({ analysis: text });

  } catch (error) {
    console.error('Analyze Error Details:', error);
    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('API_KEY_INVALID')) errorMsg = 'APIキーが無効です。';

    return res.status(500).json({
      error: 'Failed to process AI analysis',
      details: errorMsg
    });
  }
};
