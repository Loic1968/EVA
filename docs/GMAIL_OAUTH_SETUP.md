# Gmail OAuth – Guide pas à pas

## 1. Redirect URI (où Google renvoie après connexion)

Ouvre : https://console.cloud.google.com/apis/credentials

- Clique sur ton **client OAuth 2.0** (type "Web application")
- Dans **Authorized redirect URIs**, clique **+ ADD URI** et colle :
  - `http://localhost:5002/api/oauth/gmail/callback` (pour le dev local)
  - `https://eva.halisoft.biz/api/oauth/gmail/callback` (pour la prod)
- **Save**

---

## 2. OAuth consent screen – Les permissions (scopes)

Quand tu connectes Gmail depuis EVA, Google affiche une page de consentement ("Cette app demande l'accès à…"). C’est l’**OAuth consent screen**.

### Où aller

Ouvre : https://console.cloud.google.com/apis/credentials/consent

(ou menu ☰ → **APIs & Services** → **OAuth consent screen**)

### Ajouter les scopes (permissions)

1. Va sur la page **OAuth consent screen**
2. Clique sur **EDIT APP** (ou **Configure** si c’est la première fois)
3. Clique **SAVE AND CONTINUE** jusqu’à arriver à **Scopes**
4. Clique **ADD OR REMOVE SCOPES**
5. Dans la liste, coche :
   - **Gmail API** → `.../auth/gmail.readonly` (lire les emails)
   - **Gmail API** → `.../auth/gmail.send` (envoyer des emails)
   - **Gmail API** → `.../auth/gmail.compose` (créer des brouillons)
   - **User info** → `.../auth/userinfo.email` (ton email)
6. **UPDATE** puis **SAVE AND CONTINUE**

---

## 3. Utilisateurs de test – Pourquoi et comment

Si ton app est en mode **Testing** (c’est le cas par défaut), **seuls les emails ajoutés comme "Test users" peuvent se connecter**.

C’est une protection Google : pendant le développement, ton app n’est pas publiquement disponible. Seules les adresses que tu déclares peuvent autoriser Gmail.

### Où ajouter tes emails

1. Sur la page **OAuth consent screen**, section **Test users**
2. Clique **+ ADD USERS**
3. Ajoute les adresses Gmail que tu veux connecter à EVA, ex. :
   - `loic@halisoft.biz`
   - `loic.hennocq@gmail.com`
   - `loic.shanghai@gmail.com`
4. **Save**

Sans ça, même en tant que propriétaire du projet, tu peux avoir l’erreur "Request had insufficient authentication scopes" ou "Access blocked".

---

## 4. Après changement de scopes

Si tu as déjà connecté des comptes Gmail avant d’ajouter `gmail.send` et `gmail.compose` :

1. Va sur EVA → **Data Sources**
2. **Déconnecter** chaque compte Gmail
3. **Reconnecter** chaque compte – la nouvelle page de consentement demandera les bons droits
