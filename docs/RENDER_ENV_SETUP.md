# Render – Configuration des variables d'environnement

## Gmail & Calendar OAuth (obligatoire pour Data Sources)

Sans ces variables, l'erreur suivante apparaît :
> EVA_GOOGLE_CLIENT_ID et EVA_GOOGLE_CLIENT_SECRET doivent être définis

### 1. Google Cloud Console

1. Aller sur [Google Cloud Console](https://console.cloud.google.com/)
2. **APIs & Services → Library** : activer **Gmail API** et **Google Calendar API**
3. **APIs & Services → Credentials** : créer **OAuth 2.0 Client ID** (type Web application)
4. Dans **Authorized redirect URIs**, ajouter :
   - Production : `https://eva.halisoft.biz/api/oauth/gmail/callback`
   - Local : `http://localhost:5002/api/oauth/gmail/callback`
5. Copier **Client ID** et **Client secret**

### 2. Render Dashboard

1. Ouvrir le service **EVA** sur [dashboard.render.com](https://dashboard.render.com)
2. **Environment** → **Environment Variables**
3. Ajouter :

| Key | Value |
|-----|-------|
| `EVA_GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` |
| `EVA_GOOGLE_CLIENT_SECRET` | `GOCSPX-xxx` |

4. **Save Changes** → Render redéploie automatiquement

### 3. Vérification

Après redéploiement, aller sur **Data Sources** → **Connect Gmail**. Le flux OAuth doit démarrer sans erreur.
