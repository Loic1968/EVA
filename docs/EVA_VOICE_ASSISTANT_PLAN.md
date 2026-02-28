# EVA Voice Assistant — Plan

## Objectif
EVA comme vraie assistante vocale : parler naturellement, recevoir des réponses à voix haute.

---

## Problèmes actuels
1. Flow trop long : Clic mic → Arrêter → Vérifier transcription → Clic Envoyer
2. Voice/status peut échouer (auth, OPENAI_KEY)
3. Pas de flow "hold-to-talk" ou "one-tap"
4. Chat API (Claude) séparé de EVA Chat (OpenAI) — incohérent

---

## Solution

### Phase 1 : Flow simplifié (TAP-TO-TALK + AUTO-SEND)
- **Un seul bouton** : Appuyer = enregistrer, Réappuyer = stop + transcription + envoi automatique
- Pas de zone "Tu as dit" modifiable avant envoi — on envoie direct
- L'utilisateur peut corriger en tapant si besoin (optionnel)

### Phase 2 : Backend unifié pour la voix
- Utiliser `POST /api/eva/chat` (streaming OpenAI) pour la voix quand OPENAI_API_KEY est set
- Fallback : `POST /api/chat` (Claude) si pas d'OpenAI
- Une seule source de vérité pour les réponses

### Phase 3 : UX type assistant
- Grande zone centrale : bouton mic + état (idle / listening / thinking / speaking)
- Historique conversation compact
- Messages visuels + audio simultanés
- Indicateurs clairs : "J'écoute…" / "Je réfléchis…" / "Je parle…"

### Phase 4 : Fiabilité
- voice/status : évaluation lazy (pas au chargement du module)
- Fallback Web Speech API si pas de Whisper
- Messages d'erreur explicites (clé manquante, micro bloqué, etc.)

---

## Fichiers à modifier
- `eva/web/src/pages/ChatRealtime.jsx` → refonte complète
- `eva/server/routes/voice.js` → getOpenAI lazily
- `eva/web/src/hooks/useVoice.js` → option "autoSendOnStop"
- Nouvelle page `/assistant` ou remplacer `/voice` par cette UX

---

## Dépendances
| Clé | Usage |
|-----|-------|
| OPENAI_API_KEY | Whisper (STT) + TTS + EVA Chat streaming |
| ANTHROPIC_API_KEY | Chat principal EVA (fallback si pas d'OpenAI) |

Avec OPENAI_API_KEY : tout fonctionne (STT + chat + TTS).
Sans : Web Speech API (Chrome) + Claude chat + TTS navigateur.
