const OPENAI_PREFERRED_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-mini'];

function keySource(name) {
  if (name === 'google') return process.env.RIMLY_GOOGLE_API_KEY_SOURCE || 'environment';
  if (name === 'openai') return process.env.RIMLY_OPENAI_API_KEY_SOURCE || 'environment';
  return 'environment';
}

function getProviders() {
  const providers = [];
  if (process.env.GOOGLE_API_KEY) {
    providers.push({ name: 'google', label: 'Gemini', key: process.env.GOOGLE_API_KEY, keySource: keySource('google') });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({ name: 'openai', label: 'OpenAI', key: process.env.OPENAI_API_KEY, keySource: keySource('openai') });
  }
  return providers;
}

async function listGeminiModels(apiKey) {
  const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!listRes.ok) throw new Error(await listRes.text() || `Gemini model list failed: ${listRes.status}`);
  const listData = await listRes.json();
  const models = Array.isArray(listData.models) ? listData.models : [];
  return models
    .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
    .map(model => model.name.replace('models/', ''))
    .sort((a, b) => scoreModel(a) - scoreModel(b) || a.localeCompare(b));
}

async function listOpenAIModels(apiKey) {
  const listRes = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!listRes.ok) throw new Error(await listRes.text() || `OpenAI model list failed: ${listRes.status}`);
  const listData = await listRes.json();
  const models = Array.isArray(listData.data) ? listData.data : [];
  const available = new Set(models.map(model => model.id));
  const preferred = OPENAI_PREFERRED_MODELS.filter(model => available.has(model));
  return preferred.length ? preferred : OPENAI_PREFERRED_MODELS;
}

async function listProviderModels(provider) {
  if (provider.name === 'google') return listGeminiModels(provider.key);
  if (provider.name === 'openai') return listOpenAIModels(provider.key);
  return [];
}

function scoreModel(id) {
  const name = String(id).toLowerCase();
  if (name.includes('flash')) return 0;
  if (name.includes('gpt-5')) return 1;
  if (name.includes('gpt-4.1')) return 2;
  if (name.includes('gpt-4o')) return 3;
  if (name.includes('pro')) return 4;
  if (name.includes('mini')) return 5;
  return 8;
}

async function generateGemini({ provider, prompt, image }) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(provider.key);
  const models = await safeModels(provider, ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']);
  let lastError = null;

  for (const modelId of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const content = image
        ? [prompt, { inlineData: { data: image.split(',')[1] || image, mimeType: 'image/jpeg' } }]
        : prompt;
      const result = await model.generateContent(content);
      const response = await result.response;
      return { text: response.text(), provider: provider.label, model: modelId };
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model ${modelId} failed:`, error.message);
    }
  }
  throw lastError || new Error('Geminiの利用可能なモデルが応答しませんでした。');
}

async function generateOpenAI({ provider, prompt, image }) {
  const models = await safeModels(provider, OPENAI_PREFERRED_MODELS);
  let lastError = null;

  for (const model of models) {
    try {
      const content = [{ type: 'input_text', text: prompt }];
      if (image) content.push({ type: 'input_image', image_url: image });
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          input: [{ role: 'user', content }]
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || 'OpenAI response failed');
      return { text: extractOpenAIText(data), provider: provider.label, model };
    } catch (error) {
      lastError = error;
      console.warn(`OpenAI model ${model} failed:`, error.message);
    }
  }
  throw lastError || new Error('OpenAIの利用可能なモデルが応答しませんでした。');
}

async function safeModels(provider, fallback) {
  try {
    const models = await listProviderModels(provider);
    return models.length ? models : fallback;
  } catch (error) {
    console.warn(`${provider.label} model list failed:`, error.message);
    return fallback;
  }
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function generateWithAvailableProvider({ prompt, image }) {
  const providers = getProviders();
  if (!providers.length) {
    throw new Error('GOOGLE_API_KEY または OPENAI_API_KEY が設定されていません。');
  }

  let lastError = null;
  for (const provider of providers) {
    try {
      if (provider.name === 'google') return await generateGemini({ provider, prompt, image });
      if (provider.name === 'openai') return await generateOpenAI({ provider, prompt, image });
    } catch (error) {
      lastError = error;
      console.warn(`${provider.label} failed:`, error.message);
    }
  }
  throw lastError || new Error('利用可能なAIが応答しませんでした。');
}

module.exports = {
  generateWithAvailableProvider,
  getProviders,
  listProviderModels
};
