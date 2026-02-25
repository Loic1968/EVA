# Gmail & Calendar OAuth – setup local

L'erreur `EVA_GOOGLE_CLIENT_ID et EVA_GOOGLE_CLIENT_SECRET doivent être définis` signifie que les credentials Google ne sont pas configurés.

## 1. Google Cloud Console

1. Va sur [Google Cloud Console](https://console.cloud.google.com/)
2. Sélectionne ton projet (ou crée-en un)
3. **APIs & Services → Library** : active **Gmail API** et **Google Calendar API**
4. **APIs & Services → Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Type : **Web application**
6. **Authorized redirect URIs** : ajoute  
   `http://localhost:5002/api/oauth/gmail/callback`
7. Copie **Client ID** et **Client secret**

## 2. Fichier .env local

```bash
cd eva
cp .env.example .env
```

Ouvre `eva/.env` et ajoute (ou modifie) :

```
EVA_GOOGLE_CLIENT_ID=123456789-xxx.apps.googleusercontent.com
EVA_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

## 3. Redirect OAuth vers le frontend (éviter localhost:5002)

Après "Connect Gmail", Google redirige vers le callback. Sans config correcte, tu atterris sur un port inaccessible.

**IMPORTANT : EVA utilise le port 3001 (pas 5173).** Dans `eva/.env` :

```
EVA_FRONTEND_URL=http://localhost:3001
```

Si Vite affiche un autre port au démarrage (ex. 3005 car 3001-3004 occupés), utilise celui-là.

## 4. Redémarrer le serveur EVA

```bash
# Arrête le serveur (Ctrl+C) puis
npm run dev
# ou
npm run server
```

## 5. Tester

Ouvre http://localhost:3001/sources → **Connect Gmail**. Le flux OAuth doit fonctionner.
