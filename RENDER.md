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

## 2. Schéma EVA dans la base

La base utilisée par `DATABASE_URL` doit contenir le **schéma `eva`** (tables `eva.owners`, `eva.settings`, etc.).

À exécuter **une fois** sur cette base (depuis la racine du repo Halisoft si la migration est là) :

```bash
psql "$DATABASE_URL" -f migrations/2026_02_20_create_eva_schema.sql
```

Si EVA est dans un repo séparé, le SQL de la migration est dans la doc du repo EVA ou dans Halisoft sous `migrations/2026_02_20_create_eva_schema.sql`.

## 3. Vérifier après déploiement

- **https://eva.halisoft.biz/health** → doit répondre `{"status":"ok","app":"eva",...}`
- **https://eva.halisoft.biz/chat** → envoyer un message : si tout est bon, EVA répond. Si tu vois "Database unavailable. On Render: set DATABASE_URL...", (re)vérifier **DATABASE_URL** et la migration.

## 4. Build / Start sur Render

- **Build Command :** `npm install && npm run build`
- **Start Command :** `npm start`

Pas besoin de changer le **Root Directory** si le repo déployé est bien le repo EVA (racine = dossier avec `server/` et `web/`).
