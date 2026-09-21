const catalog = [
  { provider: 'openrouter', id: 'dynamic:free', label: 'Current free models', tier: 'free', discovery: true },
  { provider: 'google', id: 'configured:fast', label: 'Google fast model', tier: 'byok', capabilities: ['text','vision','tools'] },
  { provider: 'openai', id: 'configured:general', label: 'OpenAI general model', tier: 'byok', capabilities: ['text','vision','tools','structured'] },
  { provider: 'anthropic', id: 'configured:reasoning', label: 'Anthropic reasoning model', tier: 'byok', capabilities: ['text','vision','tools'] },
  { provider: 'groq', id: 'configured:fast', label: 'Groq low-latency model', tier: 'byok', capabilities: ['text','tools'] },
  { provider: 'custom', id: 'openai-compatible', label: 'Custom OpenAI-compatible endpoint', tier: 'custom', capabilities: ['configurable'] },
  { provider: 'local', id: 'ollama', label: 'Ollama / local model', tier: 'private', capabilities: ['configurable'] }
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status?.(405).json?.({ error: 'Use GET.' }) || end(res, 405, { error: 'Use GET.' });
  let freeModels = [];
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(8000) });
      const payload = await response.json();
      freeModels = (payload.data || []).filter(m => Number(m.pricing?.prompt || 1) === 0 && Number(m.pricing?.completion || 1) === 0).map(m => ({ provider: 'openrouter', id: m.id, label: m.name || m.id, tier: 'free', contextLength: m.context_length }));
    } catch { /* catalog remains usable */ }
  }
  return res.status?.(200).json?.({ models: [...freeModels, ...catalog], refreshedAt: new Date().toISOString() }) || end(res, 200, { models: [...freeModels, ...catalog], refreshedAt: new Date().toISOString() });
}
function end(res,status,payload){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));}
