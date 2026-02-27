/**
 * EVA conversation learning — extract facts from conversation (optional).
 * Fire-and-forget; failures don't block response.
 */
async function learnFromConversation(ownerId, historyWithNewTurn) {
  if (!ownerId || !Array.isArray(historyWithNewTurn)) return;
  if (process.env.EVA_STRUCTURED_MEMORY !== 'true') return;
  try {
    const factsService = require('./factsService');
    const last = historyWithNewTurn[historyWithNewTurn.length - 1];
    if (!last || last.role !== 'assistant') return;
    // Minimal extraction: could add NLP later. For now no-op to avoid errors.
  } catch (e) {
    console.warn('[EVA] conversationLearning:', e.message);
  }
}

module.exports = { learnFromConversation };
