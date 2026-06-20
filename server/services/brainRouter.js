/**
 * EVA 1 ← EVA 2 hybrid brain router (smart tiered routing)
 *
 * | Tier        | When                          | Provider              |
 * |-------------|-------------------------------|-----------------------|
 * | local       | /local, mode privé explicite  | Ollama qwen2.5:14b    |
 * | cheap       | bonjour, sourcing 中文         | DeepSeek API direct   |
 * | assistant   | emails, calendrier, tools…    | Claude/GPT (evaChat)  |
 *
 * OpenClaw gateway is NOT used for web chat (conflicts with EVA workspace context).
 */
const ollamaBrain = require('./ollamaBrain');
const deepseekBrain = require('./deepseekBrain');

const EXPLICIT_LOCAL_RE = [
  /^\/local\b/i,
  /\b(mode\s+)?(local|priv[eé]|offline)\b/i,
  /\b(ne\s+)?(envoie|envoyer|partage).*(pas|jamais).*(cloud|internet|api)\b/i,
  /本地模式|离线模式|不要上传|保密模式/,
];

const ASSISTANT_BRAIN_RE = [
  /email|mail|courrier|inbox|gmail/i,
  /vol[s]?|billet|flight|avion|voyage|travel|emirates|etihad|shanghai|pvg/i,
  /calendrier|agenda|rendez-vous|\brdv\b|meeting|appointment/i,
  /document|fichier|upload|pdf|memory\s*vault|mémoire/i,
  /cherche|trouve|search|find|lookup|vérifie|check\s+my/i,
  /rappel|retiens|souviens|remember|note\s+que/i,
  /r[eé]dig|draft|reply|r[eé]ponds?\s+(à|a)\s+(cet|ce|mon)\s+(email|mail)/i,
  /qui\s+(m'a|est)|who\s+(sent|wrote|emailed)/i,
  /mon\s+(vol|email|agenda|calendrier|document)/i,
  /my\s+(flight|email|calendar|document)/i,
  /web\s*search|actualit[eé]|news|météo|weather/i,
  /brief|bilan|r[eé]cap|priorit[eé]s?|todo|t[aâ]ches?\s+(du\s+jour|today)/i,
];

const CHINESE_SOURCING_RE = [
  /[\u4e00-\u9fff]/,
  /\b(MOQ|FOB|CIF|EXW|HS\s*code|lead\s*time)\b/i,
  /\b(fournisseur|supplier|sourcing|textile|fabric|mill|factory|usine)\b/i,
  /报价|供应商|工厂|采购|面料|样品|交期/,
];

const SIMPLE_CHAT_RE = /^(bonjour|salut|hello|hi|hey|coucou|merci|thanks|thank\s+you|ok|d'accord|ça\s*va|ca\s*va|good\s*(morning|evening|night)|bonsoir|bonne\s*nuit|tu\s*vas\s*bien)[\s!.?]*$/i;

function isHybridEnabled() {
  const v = (process.env.EVA_HYBRID_BRAIN || 'smart').trim().toLowerCase();
  return v !== 'false' && v !== 'off' && v !== '0';
}

function isExplicitLocal(text) {
  const t = (text || '').trim();
  return t && EXPLICIT_LOCAL_RE.some((re) => re.test(t));
}

function needsAssistantBrain(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return ASSISTANT_BRAIN_RE.some((re) => re.test(t));
}

function isChineseSourcing(text) {
  const t = (text || '').trim();
  if (!t || t.length > 800) return false;
  if (needsAssistantBrain(t)) return false;
  return CHINESE_SOURCING_RE.some((re) => re.test(t));
}

function isSimpleChat(text) {
  const t = (text || '').trim();
  if (!t || t.length > 120) return false;
  if (needsAssistantBrain(t)) return false;
  if (t.includes('?') && t.length > 40) return false;
  return SIMPLE_CHAT_RE.test(t);
}

function shouldTryHybrid({
  userMessage,
  isVoice,
  attachedDocuments,
  forceToolPath,
  forceLocal,
}) {
  if (!isHybridEnabled()) return false;
  if (forceToolPath) return false;
  if (isVoice) return false;
  if (attachedDocuments?.length) return false;
  if (forceLocal) return ollamaBrain.isConfigured();
  if (needsAssistantBrain(userMessage)) return false;
  if (isExplicitLocal(userMessage)) return true;
  if (isChineseSourcing(userMessage)) return true;
  if (isSimpleChat(userMessage)) return true;
  return false;
}

function selectRoute(userMessage, { forceLocal } = {}) {
  if ((forceLocal || isExplicitLocal(userMessage)) && ollamaBrain.isConfigured()) return 'ollama';
  if (deepseekBrain.isConfigured()) return 'deepseek';
  return null;
}

function getBrainStatus() {
  return {
    enabled: isHybridEnabled(),
    mode: process.env.EVA_HYBRID_BRAIN || 'smart',
    deepseek: deepseekBrain.isConfigured(),
    ollama: ollamaBrain.isConfigured(),
    openclaw_web: false,
  };
}

/**
 * @returns {Promise<object|null>} evaChat reply shape or null → fallback Claude/GPT
 */
async function tryHybridReply(ctx) {
  if (!shouldTryHybrid(ctx)) return null;

  const { systemPrompt, messages, userMessage, forceLocal } = ctx;
  const route = selectRoute(userMessage, { forceLocal });
  if (!route) return null;

  const chain = route === 'ollama' ? ['ollama'] : ['deepseek'];

  let lastErr;
  for (const step of chain) {
    try {
      const result = step === 'ollama'
        ? await ollamaBrain.complete({ systemPrompt, messages })
        : await deepseekBrain.complete({ systemPrompt, messages });
      if (process.env.EVA_DEBUG === 'true') {
        console.log(`[EVA Brain] route=${route} step=${step} ok`);
      }
      return {
        reply: result.text,
        model: result.model,
        ai_provider: step,
        brain_route: route,
        tokens: result.tokens || { input: 0, output: 0 },
      };
    } catch (e) {
      lastErr = e;
      console.warn(`[EVA Brain] ${step} failed:`, e.message);
    }
  }

  if (lastErr && process.env.EVA_DEBUG === 'true') {
    console.warn('[EVA Brain] hybrid exhausted, falling back to Claude/GPT');
  }
  return null;
}

module.exports = {
  isHybridEnabled,
  isExplicitLocal,
  needsAssistantBrain,
  isChineseSourcing,
  isSimpleChat,
  shouldTryHybrid,
  selectRoute,
  getBrainStatus,
  tryHybridReply,
};
