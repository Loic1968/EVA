# EVA — Accès au web (recherche Tavily)

EVA n’a **pas** de navigateur : elle accède au web **uniquement** via l’API **Tavily** (recherche). Si la recherche web ne marche pas, c’est en général l’une des causes suivantes.

## Pourquoi EVA n’a « pas accès à Internet » ?

1. **TAVILY_API_KEY** absente ou invalide dans l’environnement (eva/.env ou conteneur).
2. **Tavily en erreur** (quota, réseau, timeout) → le contexte contient "## Web search (erreur)" et le modèle peut répondre de façon générique.
3. **Docker** : le conteneur doit pouvoir joindre `https://api.tavily.com`. En local c’est en général OK ; en prod vérifier sortie HTTPS.

## 1. Obtenir une clé

- Va sur [tavily.com](https://tavily.com) et crée un compte (il y a un quota gratuit).
- Récupère ta clé API (format `tvly-...`).

## 2. Configurer EVA

**Sans Docker** (EVA en local) : dans `eva/.env` :

```bash
TAVILY_API_KEY=tvly-ta-cle-ici
```

**Avec Docker** : la clé peut être dans `eva/.env` ou dans `.env` à la racine du projet (les deux sont chargés par le conteneur eva-full). Exemple dans `eva/.env` :

```bash
TAVILY_API_KEY=tvly-ta-cle-ici
```

Puis redémarre EVA (ou recrée le conteneur) pour que la variable soit prise en compte.

## 3. Vérifier

En chat ou en voice, demande par exemple : « C’est quoi les dernières actualités ? » ou « Météo à Dubai ». Si la clé est bien configurée, EVA utilisera la recherche web et citera les sources.

Sans clé, EVA répond qu’elle n’a pas accès aux infos web ou que la recherche n’est pas configurée.
