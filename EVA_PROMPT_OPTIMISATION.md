# Prompt pour Cursor / Claude : Optimisation de la Latence et Mémoire d'Eva

Copie-colle ce prompt exact dans ton chat Cursor (en mentionnant `@eva/server` ou les fichiers spécifiques) ou donne-le à Claude Project.

---

**Rôle** : Tu es un architecte logiciel Senior expert en Node.js, architecture d'agents IA temps réel (type Jarvis), performances API et intégration LLM (Anthropic/OpenAI). 

**Contexte** : Je développe "Eva", mon assistante personnelle IA connectée à mes outils personnels (Gmail, Calendar, Documents). Actuellement, sa latence de réponse est beaucoup trop élevée (plusieurs secondes) ce qui casse l'expérience utilisateur. Un audit récent a révélé l'origine des ralentissements principaux:
1. Une récupération de contexte bloquante et séquentielle : dans `contextBuilder.js` et `evaChat.js`, des appels successifs sont faits à Gmail, Google Calendar, Tavily Web, et PostgreSQL (avec des `await` en série) avant même d'interroger le LLM.
2. L'absence d'utilisation systématique du streaming (Server-Sent Events) pour l'API LLM empêche l'affichage/la vocalisation immédiate du premier Token.
3. Un outil `save_memory` manuel qui interrompt le chat de manière synchrone, au lieu d'utiliser une extraction RAG (Retrieval-Augmented Generation) asynchrone pour la mémoire sémantique de long terme "Clone".

**Mission Globale** : Implémenter la Phase 1 (Quick Win Latence) et la Phase 2 (Streaming & Mémoire) du plan d'optimisation d'Eva, UNIQUEMENT en refactorisant proprement ces composants critiques SANS casser la logique métier ou de sécurité existante (ex: gestion des erreurs OAuth `authErrorBlock`, mots-clés d'intention comme `isFlightIntent`).

### Étape 1 : Parallélisation Massive du Contexte (Priorité Absolue)
**Fichiers à modifier** : `server/contextBuilder.js` et fonction `reply` dans `server/evaChat.js`.

- **Objectif** : Transformer les I/O séquentiels en exécutions parallèles. Diviser par 3 ou 4 le temps de préparation du prompt "Smart Context".
- **Tâche** : Dans `buildContext()`, identifie les appels externes coûteux :
  - `gmailSync.searchEmails` / `getRecentEmails`
  - `docProcessor.searchDocumentsWithCitations`
  - `calendarSync.getUpcomingEvents` / `searchCalendarEvents`
  - `webSearchService.search` **(ATTENTION : Ajuste les conditions/Regex pour que la recherche Web s'active facilement sur les questions générales : météo, news, infos culturelles, et pas seulement sur des villes spécifiques ou requêtes "complexes")**
  - `factsService.getFacts` et `objectsService.getActiveObjects`
- **Action Requise** : Refactore le code pour conditionner puis préparer toutes les `Promise` nécessaires dans un ou plusieurs tableaux. Exécute-les obligatoirement via `Promise.allSettled()` (très important : une erreur isolée sur l'API Tavily ne doit pas bloquer la récupération des emails Gmail). Une fois les résultats obtenus, rassemble de manière synchrone les blocs (Docs First, puis Emails, puis Calendar) dans le string final `context`.

### Étape 2 : Support Intégral du Streaming (SSE)
**Fichiers à vérifier/modifier** : `server/evaChat.js` et le routeur de chat (ex: `server/routes/eva.js`).

- **Objectif** : Réduire le Time-To-First-Token (TTFT) ressenti par le frontend (ou par un futur système vocal) à une fraction de seconde.
- **Action Requise** : Assure-toi qu'un endpoint de chat stream est activé et fonctionnel (ex : passage de `stream: true` à l'API OpenAI/Anthropic). Renvoie les chunks de texte au client via `res.write()` au format SSE (Server-Sent Events) au fur et à mesure que le modèle génère du texte. Si le code utilise encore un retour "bloquant" complet, modifie l'endpoint `/api/chat/stream` pour exposer la fonctionnalité. Il faut impérativement gérer l'interception et le traitement propre des `tool_calls` durant le stream (exécution asynchrone continue).

### Étape 3 : Transition de la Mémoire vers un Extracteur Asynchrone
**Fichier à créer / planifier** : Architecture d'un `memoryExtractionWorker.js`.

- La méthode actuelle d'obliger le LLM à appeler un outil `save_memory` en plein dialogue ajoute des requêtes intermédiaires lourdes.
- **Action Requise** : Propose le code ou la structure d'un **Worker asynchrone "Post-Process"** (ex: `conversationLearningService.js` modifié ou nouveau worker) qui s'exécute silencieusement en arrière-plan (Fire-and-forget) juste _après_ avoir renvoyé la réponse à l'utilisateur. 
- Ce process va lire le transcript du dernier échange et en extraire (via un second appel LLM non bloquant) : les habitudes régulières, relations importantes et préférences pour les encoder dans PostgreSQL sous forme d'Embeddings Vectoriels (PgVector/RAG). On s'en servira ultérieurement pour rechercher le contexte de manière globale au lieu d'injecter manuellement les "Corrections".

### Contraintes Strictes :
- **Sécurité** : Conserve et respecte tout le comportement des blocs d'erreurs d'authentification (`authErrorBlock`).
- **Tolérance aux Pannes** : Utilise scrupuleusement `try/catch` de manière isolée sur chaque requête parallèle, et préfère `Promise.allSettled()` au lieu de `Promise.all()`.
- **Exécution Step-by-Step** : Commence UNIQUEMENT par l'Etape 1 (`contextBuilder.js`). Montre-moi le fichier complet refactoré. Attends absolument ma validation formelle avant d'attaquer l'Etape 2, puis l'Etape 3.
- **Réponses Générales & Météo ("Open Knowledge")** : Assure-toi impérativement que le Prompt Système du LLM (dans `evaChat.js` ou `systemPrompt.js`) et le trigger de Tavily (`webSearchService`) permettent de répondre naturellement aux questions du quotidien (Actualités, Météo Locale, Culture Générale). Actuellement le filet anti-hallucination d'Eva est trop restrictif : supprime ou adapte les règles qui bloquent ou brident la réponse sous prétexte qu'elle "n'a pas accès à tes bases de données locales". Eva doit utiliser son "Web Search" de manière fluide pour tout ce qu'elle ne trouve pas dans le RAG.
- **Gestion du Persona "Alice"** : N'oublie pas que l'application contient un second Persona nommé "Alice" (activable via `/alice on` ou via les réglages, défini dans `prompts/alicePrompt.js`). Toutes les optimisations de streaming, de contexte parallèle et de recherche web (Tavily pour la météo/news) doivent parfaitement fonctionner quand le mode Alice est activé. Assure-toi que son Prompt (`ALICE_PROMPT`) bénéficie aussi de cette ouverture sur le "Web Search" sans perdre son ton d'Assistante Exécutive ("— Alice").
- **Commentaires Utiles** : Commente le refactoring en français afin d'expliquer pourquoi tel pattern asynchrone a été choisi.

---
