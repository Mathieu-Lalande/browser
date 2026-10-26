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
- Les permissions sensibles (caméra, micro, géoloc, notifications…) sont demandées site par site via une
  barre d'autorisation dans l'interface (décisions mémorisables par origine) ; seules les origines https
  (ou localhost) peuvent les demander. Le reste est refusé (voir ADR-008).
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

## ADR-006 — Bloqueur de contenu : moteur Ghostery, filtrage cosmétique sans preload

**Contexte.** `@ghostery/adblocker-electron` branche le moteur de Ghostery (EasyList, EasyPrivacy, listes
uBlock Origin) sur une session : blocage réseau via `webRequest`, et filtrage cosmétique via un **preload
de session** (`session.registerPreloadScript`) qui tourne dans chaque page et dialogue en IPC avec le main.
Ce preload contredit l'ADR-003 (« les pages ne reçoivent jamais de preload ») et ouvrirait un canal IPC
à toutes les pages. Le paquet désactive aussi globalement les avertissements de sécurité d'Electron à
l'import, et Electron n'accepte qu'**un seul** écouteur par événement `webRequest` : le bloqueur occuperait
seul `onBeforeRequest`/`onHeadersReceived`, dont nous avons aussi besoin (HTTPS-Only, GPC).

**Décision.** Dépendre du moteur seul, `@ghostery/adblocker` (version exacte épinglée), et l'intégrer
nous-mêmes dans `src/main/privacy/` :

- un seul pipeline `webRequest` sur la session par défaut, qui ne traite **que** les requêtes des onglets
  (jamais celles de l'interface ni du process principal) : mise à niveau HTTPS des navigations, blocage
  des sous-ressources (annulation, ou redirection vers une ressource neutre type `noop.js`), en-tête GPC ;
- **filtrage cosmétique sans preload**, piloté par le main : au commit de la page, `webContents.insertCSS`
  (origine `user`) injecte les règles du site et les règles génériques complexes ; à `dom-ready` puis à la
  fin du chargement, un script **en lecture seule** exécuté dans un *monde isolé*
  (`executeJavaScriptInIsolatedWorld`) relève classes, ids et liens présents, et le main injecte les règles
  génériques correspondantes (l'essentiel des règles d'EasyList). Aucun code ne reste dans la page, rien
  n'est exposé au monde de la page, aucun canal IPC n'est ouvert ;
- non pris en charge, car il faudrait du code résident dans la page au tout début du chargement :
  scriptlets (`##+js`), sélecteurs étendus/procéduraux, observation des éléments ajoutés après le
  chargement (MutationObserver), filtrage HTML ; les filtres `$csp` ne sont pas appliqués non plus ;
- cycle de vie : moteur sérialisé en cache (`userData/adblock/engine.bin`), chargé de façon asynchrone
  après le démarrage ; s'il manque ou date de plus de 24 h, les listes sont téléchargées (session mémoire
  dédiée, hors filtrage) et analysées dans un `worker_thread` pour ne pas bloquer le main. En cas d'échec
  (hors ligne), on navigue sans blocage et on réessaie 30 min plus tard ;
- protections désactivables par site (liste de noms d'hôte dans `userData/shields.json`, écriture
  atomique), compteur de requêtes bloquées par onglet remis à zéro à chaque navigation principale ;
- crochet de test : `BROWSER_TEST_FILTERS=<fichier>` remplace les listes téléchargées par une liste locale.

**Conséquences.** Couverture cosmétique un peu inférieure à celle d'une extension (pubs injectées
tardivement par script, anti-adblock à base de scriptlets) en échange d'un modèle de sécurité intact.
Si l'on veut combler l'écart plus tard, la voie à explorer est un content script en monde isolé injecté
par le main au début du chargement, toujours sans preload.

## ADR-007 — Mode HTTPS uniquement

- Toute navigation principale `http://` d'un onglet est réécrite en `https://` (port conservé) dans
  `onBeforeRequest`, sauf pour les hôtes locaux : `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `*.local`,
  noms sans point (intranet), plages privées et link-local IPv4/IPv6.
- Si la version https échoue (erreurs de connexion/TLS/certificat, boucle de redirections), l'onglet
  n'affiche pas la page d'erreur de Chromium : la vue est détachée et l'interface affiche une page
  « Connexion sécurisée indisponible » avec « Continuer en HTTP », qui ajoute une exception pour l'hôte
  jusqu'à la fermeture du navigateur. Les erreurs DNS ou hors ligne restent des erreurs normales.
- La décision « faut-il mettre à niveau ? » est une fonction pure testée (`src/main/privacy/https-only.ts`).

## ADR-008 — Permissions et durcissements complémentaires

- **Invite de permissions.** Comme l'interface ne peut pas dessiner au-dessus d'une `WebContentsView`,
  la demande s'affiche dans une barre au-dessus du viewport, qui le réduit (le `ResizeObserver` existant
  replace la page). File d'attente par onglet : une demande d'un onglet en arrière-plan attend qu'il
  redevienne actif ; tout ce qui est en attente est refusé si l'onglet navigue ou se ferme. « Autoriser » /
  « Bloquer » valent pour la session, ou sont enregistrés par origine (`userData/permissions.json`) avec
  « Se souvenir pour ce site ». Le *check handler* ne répond « oui » que pour une autorisation explicite.
  Seules les origines https (ou localhost) peuvent demander quoi que ce soit ; `fullscreen`, `pointerLock`
  et `clipboard-sanitized-write` restent accordées d'office. Limite connue : `getDisplayMedia` demande
  encore un sélecteur d'écran (`setDisplayMediaRequestHandler`), non implémenté.
- **Global Privacy Control.** En-tête `Sec-GPC: 1` sur les requêtes des onglets. `navigator.globalPrivacyControl`
  n'est pas exposé : il faudrait injecter du code dans la page avant ses scripts (preload).
- **Cookies tiers.** Electron n'offre pas de réglage de session pour les bloquer ; filtrer les en-têtes
  `Cookie`/`Set-Cookie` à la main serait partiel (`document.cookie` des iframes) et casserait des
  connexions (SSO). Non fait pour l'instant ; à reprendre avec les sessions partitionnées (espaces).
- **WebRTC.** Politique `default_public_interface_only` sur chaque onglet : les pages ne voient pas les
  adresses IP locales.

## ADR-009 — Espaces (sessions partitionnées) et vue scindée

**Espaces.** Un espace = nom, emoji, couleur (facultative), onglets propres (épinglés compris) et
une option « isolé ». La liste des espaces est commune à toutes les fenêtres ; chaque fenêtre en
affiche un à la fois, avec ses propres onglets pour chaque espace.

- **Composition plutôt que modification de TabManager.** `SpaceManager` (`src/main/spaces.ts`)
  possède un `TabManager` par espace (créé quand l'espace est affiché pour la première fois) ;
  `BrowserController.tabs` devient un accesseur vers le TabManager de l'espace affiché, si bien que
  l'IPC, le menu, les commandes et la palette continuent d'agir sur « les onglets à l'écran » sans
  changement. TabManager ne connaît pas les espaces ; il gagne seulement des options (`session`,
  `visible`), `setVisible`, `setSession`, et `release`/`adopt` pour déplacer un onglet.
- **Partitions.** Par défaut (comme Arc) les espaces partagent la session par défaut : on reste
  connecté partout. Un espace « isolé » (comme les conteneurs de Firefox/Zen) utilise sa propre
  partition persistante `persist:space-<id>` : cookies, stockage et cache séparés, donc des comptes
  distincts. Changer l'option recharge les onglets de l'espace dans la nouvelle session ; supprimer
  un espace isolé efface les données de sa partition.
- **Même durcissement pour toutes les sessions.** `hardenSession(ses)` est idempotent (une fois par
  session) et appliqué à chaque partition avant son premier onglet : pipeline `webRequest`
  (bloqueur, HTTPS-Only, GPC), gestionnaires de permissions, user agent nettoyé. Le moteur de
  filtres, les exceptions HTTPS, la liste des sites sans protection et les décisions de permission
  sont partagés par toutes les sessions (un choix « bloquer les notifications de X » vaut partout).
- **Déplacer un onglet** (menu contextuel natif « Déplacer vers l'espace… ») : si les deux espaces
  ont la même session, la page vivante est déplacée (ses écouteurs sont rebranchés sur le
  TabManager cible) ; sinon elle est fermée et rechargée dans la session cible.
- **Persistance.** `session.json` passe en version 2 : `{ spaces, windows: [{ activeSpaceId,
  spaces: [{ spaceId, tabs, activeIndex, split }] }] }`. Les sessions v1 sont migrées dans un espace
  par défaut « Personnel ». Le chargement paresseux est conservé : au démarrage seul l'onglet actif
  de l'espace affiché charge (ou les onglets de sa vue scindée si elle est visible).
- **Interface.** Sélecteur d'espaces en bas de la barre latérale (Ctrl+Alt+1…9, Ctrl+Alt+←/→, aussi
  dans la palette), glissement latéral de la liste d'onglets au changement d'espace, popover
  d'édition dans la barre latérale (nom, emoji, couleur, isolement, suppression confirmée). La
  couleur de l'espace remplace `--accent` dans l'interface (et est exposée en `--space-color`) ;
  sans couleur, l'accent du thème s'applique.

**Vue scindée.** 2 à 4 onglets d'un même espace côte à côte (2 colonnes ; 3 = une colonne pleine +
une colonne coupée en deux ; 4 = grille 2×2), séparés par des interstices de 8 px.

- La géométrie est une fonction pure partagée (`src/shared/split.ts`, testée) : le main l'utilise
  pour placer les `WebContentsView`, l'interface pour dessiner dans les interstices (poignées de
  redimensionnement, contour d'accent du volet actif) et les volets sans page (page d'accueil,
  interstitiel). Les interstices appartenant à l'interface, elle reçoit le glisser des séparateurs
  et renvoie les ratios au main (IPC `split:ratios`, une fois par image).
- La vue scindée est visible tant que l'onglet actif en fait partie ; cliquer dans un volet (focus
  de sa page) en fait l'onglet actif pour la barre d'adresse et les raccourcis. Dans la barre
  latérale, ses onglets sont regroupés dans une même pastille.
- Entrées : menu contextuel d'onglet (« Ouvrir en vue scindée avec l'onglet actif » / « Quitter la
  vue scindée »), `Ctrl/Cmd+Maj+\` (bascule ; sans vue scindée, l'onglet actif est associé au suivant)
  et la palette. Les vues scindées sont enregistrées dans la session.
- Limite connue : pendant le glisser d'un séparateur, si le pointeur passe très vite au-dessus
  d'une page, les mouvements dépendent de la capture implicite du clic par la vue de l'interface
  (comportement de Chromium) ; non vérifié avec un vrai pointeur dans la CI.

## ADR-010 — Calque overlay pour l'interface flottante

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

## ADR-011 — Paramètres et moteur de thème

**Décision.** Les préférences vivent dans `settings.json` (même couche de stockage qu'ADR-005).
`src/shared/settings.ts` définit le modèle, les valeurs par défaut et `sanitizeSettings`, un validateur
champ par champ : une valeur invalide retombe sur la précédente (ou la valeur par défaut) au lieu
d'invalider tout le fichier. Le process principal est le seul à écrire : l'interface envoie des
patchs partiels (`settings:update`), validés, sauvegardés puis diffusés à toutes les fenêtres
(`settings:changed`) ; tout s'applique à chaud.

- Thème : `src/shared/theme.ts` dérive toute la palette (fonds, surfaces, bordures, tons de texte)
  de la couleur d'accent et du mode clair/sombre, en OKLCH, puis ajuste la luminosité des textes
  jusqu'aux seuils WCAG AA (texte ≥ 4,5:1 sur tous les fonds et surfaces, indications ≥ 3:1),
  vérifiés par les tests pour de nombreux accents. Le résultat est un jeu de variables CSS posées sur `:root`.
- Le mode choisi pilote `nativeTheme.themeSource` : interface **et** pages web suivent
  `prefers-color-scheme`, et le fond natif de la fenêtre prend la couleur du thème (pas de flash blanc).
- Mode zen : barre latérale masquée, page bord à bord. L'interface ne voyant pas la souris au-dessus
  de la page native, une bande de 6 px reste découverte au bord de la fenêtre ; la survoler fait
  apparaître la barre, qui se masque peu après que la souris l'a quittée.

## ADR-012 — Pages internes `browser://`

**Décision.** Les pages du navigateur (`browser://settings`) sont des onglets ordinaires dont le
contenu est dessiné par l'interface, sans `WebContentsView` (comme la page d'accueil, qui reste
l'URL vide pour la compatibilité des sessions). Elles sont restaurées avec la session.

- Seul l'utilisateur peut les ouvrir : `normalizeInput` (barre d'adresse, menus) reconnaît les pages
  connues ; `isNavigableUrl` refuse le schéma `browser:`, donc une page web ne peut ni y naviguer,
  ni l'ouvrir dans un nouvel onglet, ni y être redirigée (testé en unitaire et en e2e).
- Elles ne passent jamais par l'historique ni les favoris.

## ADR-014 — Mise en veille des onglets, fenêtres privées, anti-fingerprinting

### Mise en veille des onglets (mémoire)

**Décision.** Un onglet en arrière-plan inactif depuis un délai réglable (« Jamais / 15 min / 30 min /
1 h / 2 h », 30 min par défaut, `behavior.sleepTabsAfter`) perd sa page : sa `WebContentsView` est
détruite, il garde URL, titre, favicon **et** sa liste précédent/suivant. C'est exactement l'état
« déchargé » des onglets restaurés de la session (ADR-005) : `TabManager.discard` remet `view` à null
et le mécanisme existant (`wake` à l'activation) le recharge ; rien n'est dupliqué. Au réveil, la liste
précédent/suivant est restaurée (`navigationHistory.restore`), sinon l'URL est simplement rechargée.

- Politique pure et testée (`src/main/sleep.ts`, `sleepBlocker`) : jamais un onglet à l'écran (actif,
  ou d'une vue scindée visible), qui joue du son, qui attend une réponse à une demande d'autorisation,
  ou dont les DevTools sont ouverts. Les onglets épinglés peuvent dormir : ils gardent leur place.
- Formulaires en cours : juste avant de décharger, un script **en lecture seule** exécuté dans un monde
  isolé (`executeJavaScriptInIsolatedWorld`, comme le scan cosmétique d'ADR-006, sans preload) regarde si
  un champ du document principal diffère de sa valeur initiale (`value`/`defaultValue`, cases, listes)
  ou si une zone éditable a le focus. En cas de doute (erreur, page qui ne répond pas en 2 s), l'onglet
  reste éveillé. Limites : les iframes et les éditeurs riches non focalisés ne sont pas inspectés.
- Le temps d'inactivité part du moment où l'onglet quitte l'écran (`lastSeenAt`), pas de sa dernière
  activation. Un seul minuteur pour toute l'application, réarmé à chaque passage (¼ du délai, entre
  250 ms et 1 min), `unref` ; il parcourt tous les espaces de toutes les fenêtres.
- Commandes du registre : « Mettre l'onglet en veille » (l'onglet actif cède la place au dernier
  utilisé) et « Mettre les autres onglets en veille » ; entrée « Mettre en veille » dans le menu
  contextuel d'onglet. Elles ignorent seulement le délai : son, autorisation et formulaire protègent toujours.
- Interface : `TabState.isAsleep` (déchargé, quelle qu'en soit la raison — y compris un onglet
  restauré pas encore affiché) estompe l'onglet dans la barre latérale.
- Crochet de test : `BROWSER_TEST_SLEEP_MS` remplace le délai (sauf « Jamais »).

### Fenêtres privées

**Décision.** `Ctrl/Cmd+Maj+N` (« Nouvelle fenêtre privée ») ouvre une fenêtre dont tous les onglets
utilisent une partition **en mémoire** (nom sans `persist:`), unique par fenêtre (`src/main/private.ts`).
Elle reçoit le même durcissement que les autres sessions (`hardenSession(ses, { ephemeral: true })`,
idempotent) : bloqueur, HTTPS-Only, GPC, client hints, invite de permissions.

- **Rien n'est écrit sur le disque.** `BrowserController.isPrivate` est le drapeau à consulter ; les
  règles pures sont dans `src/main/private-guards.ts` (testées) : pas de crochets d'historique (ni
  visite, ni titre/favicon, donc pas de sites fréquents), fenêtre absente de `session.json` (et sa
  fermeture ne décide jamais du sort de la session sauvegardée), jamais restaurée. Les décisions
  d'autorisation et les boucliers désactivés par site vivent dans un état propre à la session privée,
  en mémoire (`PermissionStore(null)`, carte d'hôtes) : « Se souvenir pour ce site » est masqué, les
  choix valent pour la fenêtre et ne fuient pas vers les fenêtres normales. Les exceptions HTTPS-Only
  restent en mémoire et partagées, comme avant.
- **Points d'accroche pour les autres fonctionnalités.** Ce qui persiste *par session* (téléchargements
  via `will-download`, zoom par site…) doit vérifier `isPrivateSession(session)` : le fichier téléchargé
  est enregistré où l'utilisateur l'a demandé, mais aucune entrée n'est ajoutée à l'historique des
  téléchargements ; aucun niveau de zoom n'est mémorisé.
- **Fermeture.** `clearStorageData`, `clearCache`, `clearAuthCache` et `clearHostResolverCache` sur la
  partition, sans attendre la fin de l'application.
- **Espaces.** Désactivés : une fenêtre privée a un seul espace éphémère (« Navigation privée »), hors
  de la liste partagée ; le sélecteur est masqué, l'IPC et les commandes d'espaces sont refusés.
- **Favoris.** Autorisés, comme dans Firefox : ajouter un favori est un geste explicite, il est
  enregistré dans `bookmarks.json`. Les paramètres modifiés depuis une fenêtre privée sont, eux aussi,
  enregistrés (ce sont des préférences, pas des traces de navigation).
- **Apparence.** Thème privé fixe (sombre, violet, fond « mesh », `src/shared/private.ts`) appliqué au
  chrome et à l'overlay, pastille « Navigation privée » avec un masque dans l'en-tête de la barre
  latérale, page d'accueil qui explique ce qui est conservé et ne montre pas les sites fréquents.
- La lecture de l'historique (suggestions de la barre d'adresse) reste possible, comme dans Firefox.

### Anti-fingerprinting (modeste)

**Décision.** Ce que le navigateur dit de lui dans les en-têtes HTTP ressemble à un navigateur Chromium
de bureau quelconque (`src/main/fingerprint.ts`, fonctions pures testées) :

- User agent sans `Electron/…` ni le nom de l'application, et version **réduite** comme le fait Chrome
  (`Chrome/152.0.0.0`) ; la version complète reste disponible par les client hints à haute entropie,
  exactement comme dans Chrome.
- Client hints : Chromium (Electron 44) envoie `Sec-CH-UA: "Not?A_Brand";v="24", "Chromium";v="152"`
  (vérifié), cohérent avec l'UA réduit. Par sécurité, `Sec-CH-UA` et `Sec-CH-UA-Full-Version-List`
  sont filtrés dans `onBeforeSendHeaders` (onglets seulement) : toute marque « Electron » ou au nom de
  l'application est retirée. On n'ajoute pas de fausse marque « Google Chrome ».
- `Accept-Language` : option « Uniformiser la langue envoyée aux sites » (désactivée par défaut) qui
  annonce `en-US,en;q=0.9`, la valeur la plus courante, via `session.setUserAgent(ua, langues)`.
- **Non couvert**, car il faudrait injecter du code dans les pages avant leurs scripts (preload ou
  script de monde principal), ce qu'ADR-003 exclut : canvas, WebGL, audio, polices installées,
  `navigator.userAgentData` en JavaScript (marques et version complète), `navigator.languages`,
  résolution d'écran, fuseau horaire. Une protection partielle de ces surfaces rendrait d'ailleurs
  l'utilisateur *plus* distinctif ; c'est le terrain de Tor Browser/Brave, pas un objectif à court terme.

## ADR-015 — Packaging et intégration continue

**Décision.** electron-builder (clé `build` de `package.json`) produit les paquets : `npm run dist`
(cibles par OS : AppImage + deb, NSIS, dmg) et `npm run dist:dir` (dossier décompressé, le plus rapide).
`--publish never` et `"publish": null` : aucune publication ni fichier de mise à jour automatique.

- Le code est empaqueté en **asar**. Le worker du bloqueur (`blocker-worker.ts`, chargé par chemin via
  `?modulePath` d'electron-vite) se charge **depuis l'archive** : Electron 44 prend en charge asar dans
  les `worker_threads`, y compris les imports de `node_modules` ; vérifié sur le paquet Linux, donc pas
  d'`asarUnpack`. La page overlay (seconde entrée du renderer) est empaquetée avec le reste de `out/`.
- Icônes : `build/icon.png` (512 px), `icon.ico` et `icon.icns` de l'ancien projet Tauri, utilisées
  automatiquement (`buildResources`). `desktopName` relie la fenêtre à son entrée `.desktop` sous Linux.
- Test de fumée du paquet (`tests/e2e/packaging.spec.ts`, ignoré sans `BROWSER_PACKAGED`) : l'app
  empaquetée démarre, affiche sa fenêtre et l'overlay, charge une page filtrée, et le worker tourne
  depuis `app.asar`.
- CI GitHub Actions (`.github/workflows/ci.yml`) : sur chaque push/PR, Ubuntu exécute typecheck,
  tests unitaires, build puis e2e sous `xvfb-run` (les fixtures passent `--no-sandbox`). Sur `master`,
  une matrice Ubuntu/Windows/macOS lance `npm run dist:dir` sans signature
  (`CSC_IDENTITY_AUTO_DISCOVERY=false`), le test de fumée sous Linux, et publie les dossiers comme
  artefacts (l'archive d'artefacts ne conserve pas les liens symboliques du bundle macOS : à zipper si
  l'on veut le distribuer). Actions épinglées en v4, Node 22, cache npm.
- **Mises à jour automatiques : non implémentées** (ni signature ni infrastructure) ; plan dans la roadmap.
