# Migrations EVA en production

## Automatique (Render)

Les migrations s’exécutent **automatiquement** à chaque déploiement :

1. **releaseCommand** : `node scripts/run-migrations.js` (avant le start)
2. **start** : `node scripts/run-migrations.js && node server/index.js`

Tous les fichiers `.sql` du dossier `migrations/` sont exécutés dans l’ordre alphabétique.

## Exécution manuelle (si besoin)

Si le déploiement a échoué ou si la base a été créée sans migrations :

```bash
cd eva
DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" node scripts/run-migrations.js
```

Ou avec `psql` (variable d’environnement Render) :

```bash
psql "$DATABASE_URL" -f migrations/001_create_eva_schema.sql
psql "$DATABASE_URL" -f migrations/002_add_gmail_oauth.sql
psql "$DATABASE_URL" -f migrations/003_add_calendar_events.sql
psql "$DATABASE_URL" -f migrations/003_align_prod_local_schema.sql
psql "$DATABASE_URL" -f migrations/004_add_document_file_data.sql
# ... etc
```

## Liste des migrations (ordre)

| Fichier | Description |
|---------|-------------|
| 001_create_eva_schema.sql | Schéma de base (owners, conversations, documents, etc.) |
| 002_add_gmail_oauth.sql | Gmail OAuth, emails, attachments |
| 003_add_calendar_events.sql | Table calendar_events (sync Google Calendar) |
| 003_align_prod_local_schema.sql | Colonnes manquantes (updated_at, etc.) |
| 004_add_document_file_data.sql | file_data, content_text pour upload de documents |
| 004_local_match_prod.sql | Alignement local/prod |
| 005_add_document_content.sql | Contenu des documents |
| 006_auth.sql | Authentification |
| 007_webauthn_credentials.sql | WebAuthn / passkeys |
| 008_documents_file_in_db.sql | file_data (rappel si manquant) |

## Récupérer DATABASE_URL en prod (Render)

1. Render Dashboard → Service EVA → **Environment**
2. Copier `DATABASE_URL` (ou `EVA_DATABASE_URL`)
