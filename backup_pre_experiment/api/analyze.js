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
    let modelIdsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"]; // デフォルトの優先順位
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.models && Array.isArray(listData.models)) {
          const validModels = listData.models.filter(m =>
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
          );
          // flash -> pro -> その他の順にソート
          validModels.sort((a, b) => {
             const aName = a.name.toLowerCase();
             const bName = b.name.toLowerCase();
             if (aName.includes('flash')) return -1;
             if (bName.includes('flash')) return 1;
             if (aName.includes('pro')) return -1;
             if (bName.includes('pro')) return 1;
             return 0;
          });
          if (validModels.length > 0) {
            modelIdsToTry = validModels.map(m => m.name.replace('models/', ''));
          }
        }
      }
    } catch (e) {
      console.warn("Failed to fetch models list, falling back to default list", e);
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const prompt = `
      あなたはプロのバスケットボールアナリストです。
      以下の試合データから、この試合の評価、キープレーヤー、勝敗を分けたポイントを分析して出力してください。
      出力はHTML形式で、<p>、<ul>、<li>、<strong>等のタグを使って美しく整形して返してください。
      HTMLの<body>タグや<html>タグ、Markdownのコードブロック( \`\`\`html など )は含めないでください。

      【試合データ】
      ${JSON.stringify(matchData, null, 2)}
    `;

    let text = null;
    let lastError = null;

    // 空いているモデルを探して順番に試すフォールバック処理
    for (const modelId of modelIdsToTry) {
      try {
        console.log(`Trying model: ${modelId}...`);
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        text = response.text();
        console.log(`Successfully generated with ${modelId}`);
        break; // 成功したらループを抜ける
      } catch (err) {
        console.warn(`Model ${modelId} failed:`, err.message);
        lastError = err;
        // 503や404などの場合は次のモデルへ（ループ継続）
      }
    }

    if (!text) {
      // 全てのモデルが失敗した場合
      throw lastError || new Error("利用可能なすべてのAIモデルが混雑しているか、応答しませんでした。");
    }

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
