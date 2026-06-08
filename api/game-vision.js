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
    const { image, homePlayers, awayPlayers, homeName, awayName, quarter, homeScore, awayScore } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // モデル自動選択（gemini-1.5-flash優先、vision対応）
    let selectedModelId = 'gemini-1.5-flash';
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
      console.warn('Failed to fetch models list, using default:', e.message);
    }

    const model = genAI.getGenerativeModel({ model: selectedModelId });

    // 選手リストを整形してプロンプトに渡す
    const formatPlayers = (players, teamName) => {
      if (!players || players.length === 0) return `${teamName}: 選手情報なし`;
      return `${teamName}の選手:\n` + players.map(p => `  #${p.num} ${p.name}`).join('\n');
    };

    const homePlayersStr = formatPlayers(homePlayers, homeName || 'ホーム');
    const awayPlayersStr = formatPlayers(awayPlayers, awayName || 'アウェイ');

    const prompt = `
あなたはバスケットボールの試合記録AIアシスタントです。
送られた試合シーンの写真を見て、ゲームで起きたイベント（得点・ファウル）を検出してください。

【重点：審判の合図を検出してください】
✓ スリーポイント：審判が両手を上げてV字または弧を描く
✓ ファウル：審判が笛を吹き、手を振る、またはポジションで合図
✓ テクニカルファウル：審判の手で「X」を作る合図
✓ フラグラント：審判の手で強い斜めの動き

【現在の試合状況】
- クォーター: ${quarter || 'Q1'}
- スコア: ${homeName || 'ホーム'} ${homeScore || 0} - ${awayScore || 0} ${awayName || 'アウェイ'}

【登録選手リスト】
${homePlayersStr}

${awayPlayersStr}

【あなたへの指示】
この写真を見て、以下を推定してください：
1. 写真に写っているシーンのタイプ（得点シーン・ファウルシーン・その他）
2. 得点シーンの場合：どのチームの誰が何点を決めたか（1P/2P/3P）- 審判のスリーの合図を参考
3. ファウルシーンの場合：どのチームの誰がファウルをしたか、ファウルの種類（P/O/T/U/D）
4. 背番号が見えれば優先して使い、登録選手リストと照合する

【重要なルール】
- ジャージの背番号から選手を特定してください
- 審判の手の位置・ジェスチャーを見て、3Pやファウルの種類を判断してください
- 写真から確実に判断できる情報のみ返してください
- 不明な場合は null を使い、確信度(confidence: 0.0〜1.0)も返してください
- JSON以外のテキストは一切含めないでください

【出力フォーマット（JSON）】
{
  "sceneType": "SCORE" | "FOUL" | "UNKNOWN",
  "confidence": 0.0〜1.0,
  "description": "このシーンの説明（日本語で1〜2文）",
  "events": [
    {
      "type": "SCORE" | "FOUL",
      "team": "home" | "away" | null,
      "playerNum": "背番号（文字列）" | null,
      "playerName": "選手名（登録リストから照合）" | null,
      "scoreType": "1P" | "2P" | "3P" | null,
      "foulType": "P" | "O" | "T" | "U" | "D" | null,
      "confidence": 0.0〜1.0
    }
  ]
}
`;

    const base64Data = image.split(',')[1] || image;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const response = await result.response;
    let text = response.text();

    // JSONのみ抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Gemini did not return valid JSON: ' + text);
    }

    const data = JSON.parse(jsonMatch[0]);
    return res.status(200).json(data);

  } catch (error) {
    console.error('Game Vision Error:', error);
    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('API_KEY_INVALID')) errorMsg = 'APIキーが無効です。';
    if (errorMsg.includes('User location is not supported')) errorMsg = '現在の地域ではGemini APIがサポートされていません。';

    return res.status(500).json({
      error: 'Failed to process game vision',
      details: errorMsg
    });
  }
};
