# Google OAuth — Authorized redirect URIs

Pour éviter l’erreur **400: redirect_uri_mismatch**, ajoute les URIs suivantes dans Google Cloud Console.

## Où configurer

1. Ouvre [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Clique sur ton **OAuth 2.0 Client ID** (type "Web application").
3. Dans **Authorized redirect URIs**, ajoute **exactement** :

### En local (sans Docker)
```
http://localhost:5002/api/oauth/gmail/callback
```

### En local avec Docker (EVA sur le port 5173)
```
http://localhost:5173/api/oauth/gmail/callback
```

### Production
```
https://eva.halisoft.biz/api/oauth/gmail/callback
```

4. **Save**.

L’URI doit correspondre **caractère pour caractère** à celle envoyée par l’app (pas d’espace, pas de slash final en trop).

---

## Erreur « unknownerror » après avoir autorisé l’app

Si Google affiche une page d’erreur « unknown » après le consentement :

1. **App en mode Test** : [Google Cloud Console](https://console.cloud.google.com/apis/credentials/consent) → OAuth consent screen → ajoute ton adresse Gmail dans **Test users**.
2. **Cookies tiers** : autorise les cookies pour `accounts.google.com` (Chrome : Paramètres → Confidentialité → Cookies).
3. **Navigateur** : réessaie en navigation privée, ou avec un autre navigateur (Firefox / Safari).
4. **Compte Google** : l’URL contient parfois `authuser=1` (2ᵉ compte). Connecte-toi avec le compte qui est dans les Test users.
