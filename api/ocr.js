const { generateWithAvailableProvider } = require('./ai-providers');

const prompt = `
バスケットボールのチーム名簿の画像です。
以下の情報を正確に抽出し、JSON形式で返してください。

1. チーム名（学校名、クラブ名など）
2. 選手リスト（背番号と名前のペア）
3. コーチリスト（役職名と名前のペア）

出力フォーマット例:
{
  "teamName": "大阪市立○○中学校",
  "players": [
    {"num": "4", "name": "日野 穣道"},
    {"num": "5", "name": "藤井 佐介"}
  ],
  "coaches": [
    {"num": "コーチ", "name": "山田 先生"},
    {"num": "A.コーチ", "name": "鈴木 先生"}
  ]
}

【極めて重要な注意点（背番号について）】
- 選手名の「右側」にある「No.」の列に書かれている数字が『背番号』です。
- 選手名の「左側」にある 1 から 15 までの連番は絶対に背番号として使用しないでください。

注意点:
- コーチ（先生や監督）が含まれている場合は "coaches" に入れてください。
- チームファウル、タイムアウト、審判の名前、ライセンス番号などは無視してください。
- 背景のテーブル線などは文字として認識しないでください。
- 余計な説明は一切不要です。JSONのみを返してください。
`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const result = await generateWithAvailableProvider({ prompt, image });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`${result.provider} did not return valid JSON: ${result.text}`);
    }

    const data = JSON.parse(jsonMatch[0]);
    data.provider = result.provider;
    data.model = result.model;
    return res.status(200).json(data);
  } catch (error) {
    console.error('OCR Error Details:', error);
    let details = error.message || 'Unknown error';
    if (details.includes('API_KEY_INVALID')) details = 'APIキーが無効です。コピーミスがないか確認してください。';
    if (details.includes('User location is not supported')) details = '現在の地域ではGemini APIがサポートされていません。';
    return res.status(500).json({
      error: 'Failed to process OCR',
      details
    });
  }
};
