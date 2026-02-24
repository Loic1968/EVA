# EVA sur Render – config pour que https://eva.halisoft.biz fonctionne

Si **https://eva.halisoft.biz/chat** affiche la page mais que le chat ne répond pas (ou erreur "Database unavailable"), c’est en général une **variable d’environnement** manquante.

## 1. Variables d’environnement obligatoires

Dans **Render** → service **EVA** → **Environment** :

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| **DATABASE_URL** | Oui | URL PostgreSQL (même DB que Halisoft si tu veux). Ex. `postgresql://user:pass@host:5432/dbname` |
| **ANTHROPIC_API_KEY** ou **CLAUDE_API_KEY** | Oui (pour le chat) | Clé API Anthropic pour que EVA réponde dans le chat |
| **EVA_API_KEY** | Oui (prod) | Obligatoire en prod. Same-origin (eva.halisoft.biz) autorisé sans clé. |

Optionnel :

- **EVA_OWNER_EMAIL** : `loic@halisoft.biz` (défaut)
- **EVA_ALLOWED_ORIGINS** : CORS restrictif (défaut: eva.halisoft.biz)
- **EVA_GOOGLE_CLIENT_ID** / **EVA_GOOGLE_CLIENT_SECRET** : Gmail OAuth (lecture + envoi). Voir `docs/GMAIL_OAUTH_SETUP.md`

## 2. Migrations (schéma EVA)

Les migrations sont exécutées **automatiquement** à chaque déploiement via `releaseCommand: node scripts/run-migrations.js`.

En manuel (ex. première installation ou DB vierge) :

```bash
cd eva && node scripts/run-migrations.js
```

Ou avec psql :

```bash
for f in eva/migrations/00*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## 3. Vérifier après déploiement

- **https://eva.halisoft.biz/health** → doit répondre `{"status":"ok","app":"eva",...}`
- **https://eva.halisoft.biz/chat** → envoyer un message : si tout est bon, EVA répond. Si tu vois "Database unavailable. On Render: set DATABASE_URL...", (re)vérifier **DATABASE_URL** et la migration.

## 4. Build / Start sur Render

- **Build Command :** `npm install && npm run build`
- **Start Command :** `npm start`

Pas besoin de changer le **Root Directory** si le repo déployé est bien le repo EVA (racine = dossier avec `server/` et `web/`).

## 5. Debug : le déploiement échoue

1. **Logs** : Render → EVA → Logs. Regarde l’erreur précise (build ou runtime).
2. **Build échoue** : Vérifie que le repo est bien `Loic1968/EVA` (pas Halisoft). Si monorepo Halisoft, mets **Root Directory** = `eva`.
3. **Runtime crash** : Vérifie `DATABASE_URL` et `ANTHROPIC_API_KEY`. Sans DB, l’app peut planter au premier appel API.
4. **EVA_API_KEY** : optionnel au démarrage. Si absent, un simple warning est logué.
