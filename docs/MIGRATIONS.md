# EVA — Migrations DB (local vs prod)

## Même jeu de migrations pour local et prod

Les fichiers dans `eva/migrations/*.sql` sont exécutés **dans l’ordre alphabétique** (001, 002, … 013).  
**Local et prod utilisent exactement les mêmes fichiers** ; seule la variable d’environnement change (quelle base cibler).

## Local

- **Variable** : `DATABASE_URL` ou `EVA_DATABASE_URL` (dans `eva/.env` ou le `.env` parent).
- **Lancer les migrations** :
  - `npm run migrate`  
  - ou `npm run start` (migrations puis serveur).
- **Connexion** : pas de SSL si l’URL contient `localhost` ou `127.0.0.1`.

## Prod (déploiement Docker / Render)

- Au démarrage du conteneur, la commande est :  
  `node scripts/run-migrations.js && node server/index.js`
- **Variable** : `DATABASE_URL` (ou `EVA_DATABASE_URL`) définie dans l’environnement du service (Render, etc.) = URL de la base **prod**.
- Les migrations s’exécutent donc **toujours sur la base prod** à chaque déploiement.
- **Connexion** : SSL activé pour toute URL non localhost (`rejectUnauthorized: false` pour hébergeurs type Render/Neon/Supabase).

## Lancer les migrations manuellement sur la prod (depuis ta machine)

Si tu veux migrer la prod **sans** redéployer :

1. Définir l’URL de la base prod :
   - `EVA_DATABASE_URL_PROD` ou `PROD_DATABASE_URL` dans `eva/.env` (à ne pas commiter).
2. Lancer :
   ```bash
   cd eva && node scripts/run-migrations.js --prod
   ```

## Idempotence

Les migrations sont écrites pour être **idempotentes** (`CREATE TABLE IF NOT EXISTS`, `IF NOT EXISTS` dans des blocs `DO $$`) : les relancer plusieurs fois ne crée pas de doublons ni d’erreurs. On peut donc exécuter tout le dossier à chaque déploiement.

## Résumé

| Environnement | Variable utilisée              | Quand ça tourne        |
|---------------|--------------------------------|------------------------|
| Local         | `DATABASE_URL` / `EVA_DATABASE_URL` | `npm run migrate` ou `npm run start` |
| Prod (container) | `DATABASE_URL` (env du service) | À chaque démarrage du container (`run-migrations.js && server`) |
| Prod (manuel) | `EVA_DATABASE_URL_PROD` ou `PROD_DATABASE_URL` | `node scripts/run-migrations.js --prod` |

**En résumé** : migrations identiques pour local et prod ; seul le **DATABASE_URL** change selon l’environnement.
