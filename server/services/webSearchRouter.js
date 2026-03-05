/**
 * LLM-based router: decides if a message needs web search and extracts the query.
 * No regex — handles "Il est à Paris", "De Shanghai" in context of weather/news.
 */
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();

const PROMPT = `Tu es un routeur. L'utilisateur parle en voix. Décide si répondre nécessite une recherche web (infos temps réel).
Réponds UNIQUEMENT:
- NO si pas de recherche (salutation, "oui", "tu m'entends", "tu as accès à Internet?", etc.)
- YES|<requête>|<topic> sinon. topic = news (actualités) ou general (météo, prix, etc.)

Exemples OUI:
"Quoi de neuf?" → YES|world news today|news
"C'est quoi les actualités?" → YES|world news today|news
"Les actualités" → YES|world news today|news
"Ok, quoi de neuf?" → YES|world news today|news
"C'est quoi le temps?" → YES|weather today|general
"C'est quoi le climat à Dubaï?" → YES|Dubai weather today|general
"Quoi de neuf à Dubaï?" → YES|Dubai news today|news
"Quoi de neuf à Lyon?" → YES|Lyon news today|news
"Alors de l'actualité?" (après question Dubaï/ville) → YES|Dubai news today|news (ou ville du contexte)
"Il est à Paris." (après météo) → YES|Paris weather today|general
"De Shanghai." (après météo) → YES|Shanghai weather today|general
"Actualités à Tokyo?" → YES|Tokyo news today|news
"C'est la guerre, c'est ce qui se passe" → YES|world news today|news

Exemples NO:
"Bonjour" → NO
"Oui" → NO
"Tu m'entends?" → NO
"Tu as pas accès à Internet?" → NO`;

async function routeWithLLM(message, history = []) {
  if (!message || typeof message !== 'string') return { need: false };
  const txt = message.trim();
  if (txt.length < 3) return { need: false };
  // Skip trivial replies
  if (/^(oui|non|ok|d'accord|merci|okay|yes|no|nope|yep)\s*\.?$/i.test(txt)) {
    return { need: false };
  }

  const ctx = history.length > 0
    ? `Contexte récent:\n${history.slice(-4).map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nDernier message: "${txt}"`
    : `Message: "${txt}"`;

  let response;
  try {
    if (ANTHROPIC_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic();
      const r = await client.messages.create({
        model: process.env.EVA_WEB_ROUTER_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 80,
        system: PROMPT,
        messages: [{ role: 'user', content: ctx }],
      });
      response = r.content?.[0]?.text || '';
    } else if (OPENAI_KEY) {
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: OPENAI_KEY });
      const r = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 80,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: ctx },
        ],
      });
      response = r.choices?.[0]?.message?.content || '';
    } else {
      return { need: false };
    }
  } catch (err) {
    console.warn('[webSearchRouter] LLM failed:', err.message);
    return { need: false };
  }

  const out = (response || '').trim().toUpperCase();
  if (!out.startsWith('YES|')) return { need: false };

  const parts = response.trim().split('|');
  const query = (parts[1] || txt).trim().slice(0, 500);
  const topic = /news/i.test(parts[2] || '') ? 'news' : 'general';
  return { need: true, query, topic };
}

module.exports = { routeWithLLM };
