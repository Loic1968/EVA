# Prompt Claude Code — Intégration EVA 2 → EVA 1

> Copie le bloc **PROMPT** ci-dessous dans Claude Code pour continuer le travail.
> Repo : `https://github.com/Loic1968/EVA` · Branche : `feature/eva2-integration`

---

## PROMPT (à coller tel quel)

```
CONTEXTE PROJET

Deux systèmes Eva coexistent sur le Mac mini de Loic (fondateur Halisoft — fintech factoring / trade finance) :

| | EVA 1 (web) | EVA 2 (OpenClaw) |
|---|---|---|
| Repo | github.com/Loic1968/EVA | ~/.openclaw/ + halisoft/eva-openclaw/ |
| Accès | localhost:3001 · eva.halisoft.biz | Telegram @Halisoft2bot |
| Stack | Node/Express :5002 + React/Vite :3001 | OpenClaw gateway :18789 |
| Force | Gmail, calendrier, docs, voix /voice, Claude + tools | Hybride 24/7 DeepSeek→Claude→Ollama |

OBJECTIF DE CETTE BRANCHE

Intégrer les évolutions EVA 2 dans EVA 1 SANS dégrader l’assistant web.
Leçon apprise : router tout le chat via OpenClaw gateway (= agent Telegram + 16k tokens de contexte) rend EVA 1 « stupide ».
→ OpenClaw gateway interdit pour le web. DeepSeek API direct OK.

ÉTAT ACTUEL (branch feature/eva2-integration, commit dd55347)

✅ Fait :
- Persona EVA 2 (garde-fous chef de cabinet) → server/prompts/eva2Persona.js injecté dans getSystemPromptBase()
- Routage smart → server/services/brainRouter.js
  • Claude + tools : emails, calendrier, docs, brief, drafts, mémoire
  • DeepSeek direct : bonjour/merci, sourcing 中文 (MOQ, fournisseur, 供应商…)
  • Ollama local : commande /local uniquement (données sensibles hors cloud)
- Providers : server/services/deepseekBrain.js, ollamaBrain.js (openclawBrain.js existe mais unused web)
- Commande /local dans parseCommand + routes/eva.js (forceLocal → Ollama)
- Modèle défaut : claude-sonnet-4-6 (plus claude-sonnet-4-20250514 qui 404)
- Provider défaut settings : claude (plus gpt)
- /api/status expose brain + eva2_persona
- Tests : server/__tests__/brainRouter.test.js, alice.test.js mis à jour
- .env.example documenté

⏳ À faire (priorité) :
1. git push -u origin feature/eva2-integration (auth GitHub manquante sur Mac mini au moment du handoff)
2. Ouvrir PR vers main avec gh pr create
3. Tester manuellement :
   - POST /api/chat "Résume mes emails" → ai_provider: claude
   - POST /api/chat "Bonjour" → ai_provider: deepseek (EVA_HYBRID_BRAIN=smart)
   - POST /api/chat "/local Quelle marge GTLL ?" → ai_provider: ollama
   - Chinese: "这个供应商的MOQ是多少？" → deepseek
4. Ne PAS committer .env (secrets)

VARIABLES .env (local, non versionné)

EVA_HYBRID_BRAIN=smart          # smart | true | false
EVA2_PERSONA=true               # false pour désactiver persona EVA2
EVA_CHAT_MODEL=claude-sonnet-4-6
DEEPSEEK_API_KEY=sk-...
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:14b
ANTHROPIC_API_KEY=sk-ant-...
EVA_SKIP_AUTH=true
EVA_OWNER_EMAIL=loic.hennocq@halisoft.biz

ARCHITECTURE ROUTAGE (evaChat.js → reply())

1. Intent router (check-in, validation…) — pas de LLM
2. preAnswer si applicable
3. brainRouter.tryHybridReply() SI shouldTryHybrid() — sinon skip
4. GPT ou Claude path avec tools (calendar, gmail, mcp, memory…)

Règle d’or : needsAssistantBrain() = false requis pour hybrid, SAUF forceLocal (/local).

FICHIERS CLÉS

server/evaChat.js              — hook hybrid + getSystemPromptBase + /local
server/services/brainRouter.js — logique de routage
server/prompts/eva2Persona.js  — garde-fous EVA 2
server/prompts/alicePrompt.js  — Alice + alignement EVA 2
server/routes/eva.js           — /api/chat, forceLocal
server/index.js                — /api/status

DÉMARRAGE LOCAL

cd ~/Documents/Projects/halisoft
docker compose up -d                    # Postgres :5433 si besoin offline
cd EVA && npm run migrate && npm run dev
# Web : http://localhost:3001  API : http://localhost:5002

OpenClaw (EVA 2, séparé) :
openclaw status                         # gateway :18789
# Telegram : @Halisoft2bot
# Cron briefs 08h/18h/vendredi → ~/.openclaw/

CONTRAINTES

- Minimiser le scope — pas de refactor hors intégration EVA2
- Ne pas réactiver OpenClaw gateway pour le web chat
- Ne jamais committer .env ni clés API
- Garder Claude + tools pour tout ce qui touche Gmail/calendrier/docs
- Tests : node --test server/__tests__/brainRouter.test.js server/__tests__/alice.test.js

COMMANDES GIT ATTENDUES

cd ~/Documents/Projects/halisoft/EVA
git checkout feature/eva2-integration
git push -u origin feature/eva2-integration
gh auth login   # si gh absent : brew install gh
gh pr create --title "feat: EVA 2 persona and smart hybrid brain for EVA 1 web" \
  --base main --head feature/eva2-integration

LIENS

- Repo : https://github.com/Loic1968/EVA
- Compare PR : https://github.com/Loic1968/EVA/compare/main...feature/eva2-integration
- EVA 1 local : http://localhost:3001/voice (voix) · http://localhost:3001 (chat)
- Guide OpenClaw origine : ~/Downloads/Eva-OpenClaw-Prompt-Codex 2.md

TÂCHE IMMÉDIATE

1. Vérifier que la branche feature/eva2-integration est à jour
2. Pousser + créer la PR
3. Lancer les tests et un smoke test API
4. Signaler tout échec avec logs exacts
```

---

## Checklist rapide

- [ ] Branche `feature/eva2-integration` poussée sur GitHub
- [ ] PR ouverte vers `main`
- [ ] `npm run dev` OK
- [ ] Chat complexe → Claude
- [ ] Bonjour → DeepSeek
- [ ] `/local …` → Ollama
- [ ] `.env` hors git

---

## Sources

- OpenClaw : https://docs.openclaw.ai
- Repo EVA : https://github.com/Loic1968/EVA
- Persona EVA 2 live : `~/.openclaw/workspace/SOUL.md`
