# Décisions d'architecture

## ADR-001 — Electron (Chromium) plutôt que Tauri

**Contexte.** Le projet démarrait sur Tauri 2. Tauri affiche ses pages avec la webview *du système* :
WebKitGTK sous Linux, WebView2 (Chromium) sous Windows, WKWebView sous macOS.

**Problème.** C'est idéal pour une app dont on maîtrise le contenu, mais pas pour un navigateur :

- trois moteurs différents ⇒ le même site se comporte différemment selon l'OS (WebKitGTK en particulier est en retard) ;
- le multi-webview de Tauri est encore derrière le flag `unstable` ;
- pas d'interception réseau homogène (indispensable pour un bloqueur de pubs/traqueurs fiable) ;
- pas d'extensions, pas de DevTools en production, pas de contrôle fin des sessions/partitions (espaces, conteneurs).

**Décision.** Electron : un seul moteur (Chromium) partout, `WebContentsView` par onglet, `session`
partitionnées (espaces, navigation privée), `webRequest` pour le blocage, sandbox Chromium,
support partiel des extensions Chrome. C'est le même compromis qu'Arc (Chromium) — Zen, lui, forke Firefox,
ce qui demande une équipe dédiée au moteur.

**Conséquences.** Binaire plus lourd (~100 Mo) qu'avec Tauri, compensé par la cohérence et la vitesse de Chromium.
La logique « navigateur » vit dans le process principal, ce qui garderait une migration vers un fork Chromium/CEF possible plus tard.

## ADR-002 — Svelte 5 pour l'interface du navigateur

L'ancien rendu reconstruisait tout le DOM via `innerHTML` à chaque changement (perte du focus, coût en CPU,
risque XSS). Svelte 5 (runes) compile vers du DOM fin-grain sans runtime lourd : idéal pour une UI
réactive (onglets qui chargent, favicons, titres) qui doit rester fluide.

## ADR-003 — Modèle de sécurité

- Interface (« chrome ») : `contextIsolation`, `sandbox`, pas de Node ; seule une API typée et validée
  (`window.browser`) est exposée par le preload. CSP stricte.
- Pages web : `WebContentsView` sandboxées, sans preload, `webSecurity` actif, pas de `<webview>`.
- Les pages ne peuvent charger que `http(s)`, `about:` et `data:` ; `file:` / `javascript:` sont refusés.
- Les permissions (caméra, micro, géoloc, notifications…) sont refusées par défaut tant que l'invite
  de permission n'existe pas.
- Chaque message IPC est validé et n'est accepté que s'il provient d'une fenêtre du navigateur.

## ADR-004 — Moteur de recherche par défaut

DuckDuckGo par défaut (cohérent avec « privé ») ; Brave Search, Startpage et Google proposés.

## ADR-005 — Persistance en fichiers JSON

**Décision.** Session, historique et favoris sont des fichiers JSON dans le dossier de profil
(`userData`, ou `BROWSER_PROFILE_DIR`) : `session.json`, `history.json`, `bookmarks.json`.
Pas de dépendance (SQLite natif compliquerait le packaging et les rebuilds Electron) ; les volumes
restent petits (historique plafonné à 10 000 URL, les plus anciennes sont supprimées).

- Format `{ version, data }` : chaque fichier a un numéro de schéma, migré au chargement.
- Écriture atomique : fichier temporaire + `fsync` + `rename`, jamais de fichier tronqué.
- Sauvegardes regroupées (debounce) et forcées à la fermeture ; contenu inchangé ⇒ pas d'écriture.
- Fichier illisible ou d'une version plus récente ⇒ mis de côté en `*.corrupt-<horodatage>`, on repart à vide.
- La logique (validation, historique, recherche, favoris) est pure et testée ; seul `src/main/profile.ts` touche à Electron.
- Restauration paresseuse : seul l'onglet actif se charge au démarrage, les autres gardent
  URL/titre/favicon et n'ont pas de `WebContentsView` tant qu'ils ne sont pas activés.
- Historique et favoris ne sont accessibles qu'à l'interface (IPC validé), jamais aux pages web.

**À revoir** si l'historique doit garder chaque visite (et non une ligne par URL) ou grossir
fortement : SQLite (`node:sqlite`) serait alors le bon outil.

## ADR-006 — Calque overlay pour l'interface flottante

**Contexte.** Chaque onglet est une `WebContentsView` native ajoutée *au-dessus* du webContents de la
fenêtre : l'interface (chrome) ne peut rien dessiner sur la page. Une palette de commandes, des menus
ou des popovers façon Arc doivent pourtant flotter au-dessus.

**Décision.** Un calque « overlay » par fenêtre (`src/main/overlay.ts`) : une `WebContentsView`
transparente (`setBackgroundColor("#00000000")`) qui charge une seconde entrée du même bundle
(`overlay.html`, racine Svelte `src/renderer/src/overlay/`) avec le même preload durci.

- Attachée au-dessus des onglets seulement quand une UI flottante est ouverte, puis détachée : la page
  reçoit à nouveau clics et clavier. Si une vue d'onglet est attachée pendant ce temps, l'overlay est remonté.
- Créée paresseusement mais préchauffée juste après l'affichage de la fenêtre, puis gardée chargée :
  ouvrir = envoyer la requête + `addChildView` + focus (premier rendu mesuré à 7–27 ms après Ctrl+K sous xvfb).
- Fermeture (Échap, clic sur le fond, action) : focus rendu à ce qui l'avait (annulation) ou à la page active.
- Sécurité : `src/main/window.ts` tient un registre `webContents.id → BrowserController` des interfaces
  du navigateur (chrome **et** overlay) ; c'est la liste blanche des émetteurs IPC. Les pages d'onglets n'y
  sont jamais inscrites (et n'ont pas de preload).
- Flou : CSS (`backdrop-filter`) ne peut pas flouter une vue native située derrière. L'overlay affiche
  un voile translucide immédiatement, puis main envoie une capture réduite (¼, JPEG) du chrome et de la
  page active, floutée en CSS. Coût mesuré : ~6–11 ms de capture + ~4 ms d'encodage par calque, fait
  *après* l'ouverture (jamais sur le chemin critique) ; l'image n'est ni stockée ni envoyée ailleurs.

**Conséquences.** Les futures UI flottantes (menus contextuels, popovers) se branchent sur le même calque
(`OverlayKind`). Le thème doit être appliqué aux deux pages (chrome et overlay), qui partagent `global.css`.
