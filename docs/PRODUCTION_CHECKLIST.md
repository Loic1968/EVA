# EVA — Checklist production

## Obligatoire

| Variable | Description |
|----------|-------------|
| `NODE_ENV=production` | Déjà fixé par la plupart des hébergeurs (Render, etc.) |
| `EVA_JWT_SECRET` | **Secret fort (min. 32 caractères aléatoires).** Ne pas laisser `change-me-in-production`. |
| `ANTHROPIC_API_KEY` | Chat + indexation documents (Claude). |
| `DATABASE_URL` ou `EVA_DATABASE_URL` | PostgreSQL (schéma `eva` + migrations à jour). |

## À ne pas faire en prod

- **Ne pas** mettre `EVA_SKIP_AUTH=true` (sinon tout le monde = même utilisateur par défaut).

## Recommandé

| Variable | Description |
|----------|-------------|
| `EVA_API_KEY` | Clé partagée pour protéger l’API (optionnel mais recommandé ; un warning s’affiche au démarrage si absent en prod). |
| `EVA_ALLOWED_ORIGINS` | Origines CORS autorisées, ex. `https://eva.halisoft.biz,https://app.halisoft.biz` (défaut déjà restrictif en prod). |
| `EVA_FRONTEND_URL` | URL du front (ex. `https://eva.halisoft.biz`) pour redirections OAuth et liens. |
| `OPENAI_API_KEY` | Voice (Whisper + TTS) + option Realtime. Sans ça, pas de voix. |
| `TAVILY_API_KEY` | Recherche web (actualités, etc.). Sans ça, pas de recherche web. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail/Calendar (optionnel). |

## OAuth Google (si Gmail/Calendar)

- En prod : `GOOGLE_OAUTH_REDIRECT_URI` ou redirect configuré = `https://<ton-domaine-eva>/api/oauth/gmail/callback`.
- Ajouter cette URI dans la console Google Cloud (Credentials → OAuth 2.0).

## Déploiement

- Build : `docker compose build eva-full` (ou build hébergeur à partir de `eva/Dockerfile`).
- Les migrations sont lancées au démarrage (`scripts/run-migrations.js`).
- Health : `GET /health` (retourne `status: ok`, `tavily`, `anthropic`).

## Résumé

**Prêt pour la prod** si :
1. `EVA_JWT_SECRET` fort et unique.
2. `EVA_SKIP_AUTH` non défini (ou `false`).
3. `ANTHROPIC_API_KEY` + base de données OK.
4. (Recommandé) `EVA_ALLOWED_ORIGINS` et `EVA_FRONTEND_URL` alignés sur ton domaine.
