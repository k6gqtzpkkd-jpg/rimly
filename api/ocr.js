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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
