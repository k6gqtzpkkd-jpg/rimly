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
    const { image } = req.body; // Base64 encoded image
    if (!image) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 動的に利用可能なモデルを取得し、「flash」か「pro」を含むモデルを自動選択する
    // (将来のモデルバージョンアップで1.5-flash等のハードコードがNot Foundになるのを防ぐため)
    let selectedModelId = "gemini-1.5-flash"; // デフォルト
    try {
      // genAIの生APIを叩いてモデル一覧を取得（REST API経由）
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.models && Array.isArray(listData.models)) {
          // generateContentをサポートしているモデルをフィルタ
          const validModels = listData.models.filter(m => 
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
          );
          // flashモデルを優先、なければproモデル、なければ最初のモデル
          const flashModel = validModels.find(m => m.name.toLowerCase().includes('flash'));
          const proModel = validModels.find(m => m.name.toLowerCase().includes('pro'));
          
          if (flashModel) selectedModelId = flashModel.name.replace('models/', '');
          else if (proModel) selectedModelId = proModel.name.replace('models/', '');
          else if (validModels.length > 0) selectedModelId = validModels[0].name.replace('models/', '');
          
          console.log("Dynamically selected model:", selectedModelId);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch models list, falling back to default", e);
    }

    const model = genAI.getGenerativeModel({ model: selectedModelId });

    const prompt = `
      バスケットボールのチーム名簿の画像です。
      以下の情報を正確に抽出し、JSON形式で返してください。

      1. チーム名（学校名、クラブ名など）
      2. 選手リスト（背番号と名前のペア）

      出力フォーマット例:
      {
        "teamName": "大阪市立○○中学校",
        "players": [
          {"num": "4", "name": "日野 穣道"},
          {"num": "5", "name": "藤井 佐介"}
        ]
      }

      【極めて重要な注意点（背番号について）】
      - 選手名の「右側」にある「No.」の列に書かれている数字が『背番号』です。（大抵4番、5番〜18番など）
      - 選手名の「左側」にある 1 から 15 までの連番（行番号）は絶対に背番号として使用しないでください。間違えないように注意してください。

      注意点:
      - チームファウル、タイムアウト、審判の名前、ライセンス番号などは無視してください。
      - 背番号（No.）と選手名（Players）の対応を正確に紐づけてください。
      - 氏名にスペースが含まれる場合は、そのまま含めてください。
      - 余計な説明（「OK、わかりました」など）は一切不要です。JSONのみを返してください。
    `;

    // Extract base64 content
    const base64Data = image.split(',')[1] || image;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg"
        }
      }
    ]);

    const response = await result.response;
    let text = response.text();
    
    // Markdown code blocks cleanup and robust JSON extraction
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Gemini did not return valid JSON: ' + text);
    }
    
    const data = JSON.parse(jsonMatch[0]);
    return res.status(200).json(data);

  } catch (error) {
    console.error('OCR Error Details:', error);
    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('API_KEY_INVALID')) errorMsg = 'APIキーが無効です。コピーミスがないか確認してください。';
    if (errorMsg.includes('User location is not supported')) errorMsg = '現在の地域(Region)ではGemini APIがサポートされていません。';
    
    return res.status(500).json({ 
      error: 'Failed to process OCR', 
      details: errorMsg,
      stack: error.stack // デバッグ用に一応。必要なくなれば消す。
    });
  }
};
