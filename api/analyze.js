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

    // 環境・地域・APIキーによって利用可能なモデルが異なるため、動的にリストを取得して最適なものを選択する
    let selectedModelId = "gemini-1.5-flash"; // デフォルト
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.models && Array.isArray(listData.models)) {
          const validModels = listData.models.filter(m =>
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
          );
          const flashModel = validModels.find(m => m.name.toLowerCase().includes('flash'));
          const proModel = validModels.find(m => m.name.toLowerCase().includes('pro'));

          if (flashModel) selectedModelId = flashModel.name.replace('models/', '');
          else if (proModel) selectedModelId = proModel.name.replace('models/', '');
          else if (validModels.length > 0) selectedModelId = validModels[0].name.replace('models/', '');
        }
      }
    } catch (e) {
      console.warn("Failed to fetch models list, falling back to default", e);
    }

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
