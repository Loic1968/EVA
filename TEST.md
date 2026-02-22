# Comment tester EVA

## Prérequis

- Node.js 20+
- PostgreSQL (même instance que Halisoft) avec le schéma `eva` créé
- `DATABASE_URL` dans `.env` à la racine du projet ou dans `eva/.env`

---

## 1. Appliquer la migration (une seule fois)

À la **racine du repo** (Halisoft-platform) :

```bash
# Remplace par ta vraie URL si besoin (même DB que Halisoft)
export DATABASE_URL="postgresql://user:password@localhost:5432/trade_finance2"
psql "$DATABASE_URL" -f migrations/2026_02_20_create_eva_schema.sql
```

Vérifier que le schéma existe :

```bash
psql "$DATABASE_URL" -c "\dt eva.*"
```

Tu dois voir : `eva.owners`, `eva.settings`, `eva.drafts`, `eva.audit_logs`, etc.

---

## 2. Démarrer le backend EVA

```bash
cd eva
cp .env.example .env
# Édite .env : mets DATABASE_URL (ou laisse si déjà dans le .env racine)
npm install
npm run server
```

Tu dois voir : `[EVA] API listening on http://localhost:5002`

---

## 3. Tester l’API (terminal)

Dans un **autre terminal** (sans arrêter le serveur) :

```bash
# Santé
curl -s http://localhost:5002/health | jq .

# Liste des drafts (vide au début)
curl -s http://localhost:5002/api/drafts | jq .

# Créer un draft de test
curl -s -X POST http://localhost:5002/api/drafts \
  -H "Content-Type: application/json" \
  -d '{"channel":"email","subject_or_preview":"Test","body":"Hello from EVA test","confidence_score":0.92}' | jq .

# Relancer la liste des drafts (tu dois voir le draft)
curl -s http://localhost:5002/api/drafts | jq .

# Settings (kill switch)
curl -s http://localhost:5002/api/settings | jq .
curl -s -X PUT http://localhost:5002/api/settings/kill_switch \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' | jq .

# Audit log
curl -s http://localhost:5002/api/audit-logs | jq .
```

(Si tu n’as pas `jq`, enlève `| jq .` pour voir le JSON brut.)

---

## 4. Tester le portail web

Dans un **autre terminal** :

```bash
cd eva/web
npm install
npm run dev
```

Ouvre **http://localhost:3001** dans le navigateur.

- **Dashboard** : statut, nombre de drafts, derniers logs.
- **Drafts** : tu dois voir le draft créé à l’étape 3 ; tu peux cliquer Approve / Reject.
- **Audit log** : liste des actions (vide au début sauf si tu as POSTé un audit log).
- **Settings** : Kill switch Pause / Resume.
- **Data sources** : vide (Phase 1 à connecter plus tard).

---

## 5. Tout lancer en une commande

Depuis `eva/` :

```bash
npm run dev
```

Cela démarre le backend (5002) et le portail (3001). Ouvre http://localhost:3001 et teste les pages.

---

## 6. Script de test rapide (smoke test)

**Prérequis :** migration appliquée (étape 1) et backend lancé sur 5002.

Depuis `eva/` :

```bash
npm run test:smoke
```

Ce script vérifie `GET /health`, `GET /api/drafts`, `GET /api/settings`. Si la migration n’est pas faite, seuls `/health` passera et les deux autres échoueront (relation `eva.owners` manquante).

---

## Dépannage

| Problème | Solution |
|----------|----------|
| `Connection refused` sur 5002 | Le backend EVA n’est pas démarré : `cd eva && npm run server`. |
| `relation "eva.owners" does not exist` | La migration n’a pas été exécutée : voir étape 1. |
| Port 5002 déjà utilisé | Dans `eva/.env` mets `EVA_PORT=5003` (et dans `eva/web/vite.config.js` proxy target `5003`). |
| Le portail affiche "Error" | Vérifie que le backend tourne sur 5002 et que le proxy Vite pointe vers 5002. |
