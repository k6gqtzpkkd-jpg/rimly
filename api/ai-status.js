const { getProviders, listProviderModels } = require('./ai-providers');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providers = getProviders();
  if (!providers.length) {
    return res.status(200).json({
      apiServer: true,
      hasGoogleApiKey: false,
      hasOpenAiApiKey: false,
      keySource: null,
      selectedProvider: null,
      selectedModel: null,
      availableModels: [],
      message: 'GOOGLE_API_KEY または OPENAI_API_KEY が設定されていません'
    });
  }

  const providerStatuses = [];
  for (const provider of providers) {
    try {
      const models = await listProviderModels(provider);
      providerStatuses.push({
        provider: provider.label,
        keySource: provider.keySource,
        selectedModel: models[0] || null,
        availableModels: models,
        ok: models.length > 0,
        message: models.length ? 'AIモデルを取得できました' : '利用可能なAIモデルが見つかりません'
      });
    } catch (error) {
      providerStatuses.push({
        provider: provider.label,
        keySource: provider.keySource,
        selectedModel: null,
        availableModels: [],
        ok: false,
        message: error.message || 'AIモデルの取得に失敗しました'
      });
    }
  }

  const primary = providerStatuses.find(status => status.ok) || providerStatuses[0];
  return res.status(200).json({
    apiServer: true,
    hasGoogleApiKey: !!process.env.GOOGLE_API_KEY,
    hasOpenAiApiKey: !!process.env.OPENAI_API_KEY,
    keySource: primary.keySource,
    selectedProvider: primary.provider,
    selectedModel: primary.selectedModel,
    availableModels: primary.availableModels,
    providers: providerStatuses,
    message: primary.message
  });
};
