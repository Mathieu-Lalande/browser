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
- La décision « faut-il mettre à niveau ? » est une fonction pure testée (`src/shared/https-only.ts`,
  partagée avec l'application mobile, ADR-016).

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

## ADR-013 — Téléchargements, recherche dans la page, zoom par site, médias

**Téléchargements** (`src/main/downloads/`).

- `installDownloads(session)` branche `will-download` sur une session ; idempotente, elle est appelée
  par le durcissement de session (`hardenSession`), donc pour chaque session le jour où il y en aura une
  par espace. Seules les pages d'onglets téléchargent (`isTabPage`, le registre de la couche privacy) :
  un téléchargement venu de l'interface, de l'overlay ou d'ailleurs est annulé.
- Pas de boîte de dialogue : le fichier va directement dans le dossier choisi (paramètre
  « Téléchargements », par défaut le dossier Téléchargements du système), sous un nom nettoyé
  (séparateurs, caractères réservés, noms de périphériques Windows, fichiers cachés) et unique
  (« rapport (1).pdf » ; les noms promis aux téléchargements en cours sont réservés). « Toujours demander
  où enregistrer » rend la main à la boîte de dialogue d'Electron. Le dossier ne se choisit que par le
  sélecteur natif (`dialog.showOpenDialog` dans main) ; le validateur des paramètres n'accepte de toute
  façon que des chemins absolus.
- **Fichiers dangereux** (exécutables, installeurs, scripts, raccourcis : `.exe`, `.msi`, `.bat`, `.js`,
  `.ps1`, `.jar`, `.app`, `.dmg`, `.pkg`, `.deb`, `.sh`, `.AppImage`…, dernière extension, points et
  espaces finaux ignorés comme le fait Windows — classification pure et testée) : téléchargés sous un nom
  neutre (`<id>.download`) dans `userData/Unconfirmed downloads`, jamais dans le dossier de l'utilisateur
  sous leur vrai nom. Ils restent « à confirmer » : « Conserver » (une fois terminés) les déplace vers le
  dossier sous un nom unique, « Supprimer » les efface. Au redémarrage, ce qui n'a pas été confirmé est
  supprimé (l'entrée revient « Annulé »).
- **Rien ne s'ouvre tout seul.** « Ouvrir » (`shell.openPath`) n'est proposé qu'à un fichier terminé et
  confirmé, « Afficher dans le dossier » utilise `shell.showItemInFolder`. L'interface ne désigne un
  téléchargement que par son identifiant : aucun chemin ne vient jamais du renderer.
- État : un réducteur pur (`applySnapshot`) traduit les mises à jour du `DownloadItem` (progression,
  vitesse de Chromium, pause, reprise possible, fin). Historique `downloads.json` (couche ADR-005,
  500 entrées, les plus anciennes terminées partent d'abord) ; un téléchargement en cours au moment de
  quitter revient « Interrompu ». Les progrès sont diffusés à toutes les interfaces au plus 4 fois par
  seconde, les changements d'état immédiatement, sous forme de différences (`DownloadsChange`).
- Interface : bouton dans le pied de la barre latérale (anneau de progression, pastille si un fichier
  attend une confirmation), **popover dans le calque overlay** (ADR-010, `OverlayKind` « downloads »,
  ancré au bouton, sans voile ni flou : `isPopover`), et page interne `browser://downloads` (recherche,
  effacement de la liste, jamais des fichiers). Ctrl+Maj+J (⌥⌘L sous macOS).

**Recherche dans la page** (`src/main/find.ts`) : `findInPage` / `found-in-page` / `stopFindInPage` de
Chromium. La barre est une **bande au-dessus de la page qui réduit le viewport**, comme la barre de
permissions, et non l'overlay : l'overlay est une vue plein écran qui prend le focus et intercepte les
clics, alors qu'on doit pouvoir lire, faire défiler et cliquer la page pendant une recherche. La requête,
la casse et le compteur (« 3/17 ») vivent dans l'état de l'onglet (`TabState.find`) : chaque onglet garde
sa recherche. Entrée / Maj+Entrée, F3 / Maj+F3 (⌘G / ⇧⌘G), Ctrl+G ; Échap ferme et rend le focus à la page.
Sans effet sur la page d'accueil et les pages internes ; une nouvelle page chargée barre ouverte est
recherchée à nouveau.

**Zoom par site** (`src/main/zoom/`) : facteur mémorisé par hôte dans `zoom.json` (seulement s'il diffère
du zoom par défaut, 2 000 hôtes au plus), appliqué à chaque navigation et propagé aux autres onglets du
même site, quelle que soit la fenêtre (et demain la session : Chromium ne le fait qu'à l'intérieur d'une
session). Ctrl+molette suit les mêmes paliers. « Zoom par défaut » (67–175 %) dans Apparence ; la barre
d'adresse affiche le zoom quand il diffère du défaut, un clic le réinitialise.

**Médias** : « Image dans l'image » exécute un court script dans un monde isolé (`executeJavaScriptInIsolatedWorld`,
geste utilisateur transmis, aucun preload : ADR-003) qui choisit la vidéo en cours de lecture, sinon la
plus visible, ou quitte le mode. Limite : les vidéos dans des iframes ne sont pas trouvées. Les onglets
qui jouent du son (`audio-state-changed`) affichent un haut-parleur qui coupe/rétablit le son
(`setAudioMuted`) ; commande « Couper le son de l'onglet », Ctrl+M (Ctrl et non ⌘ sous macOS, où ⌘M
réduit la fenêtre ; c'est le raccourci de Firefox).

## ADR-014 — Mise en veille des onglets, fenêtres privées, anti-fingerprinting

### Mise en veille des onglets (mémoire)

**Décision.** Un onglet en arrière-plan inactif depuis un délai réglable (« Jamais / 15 min / 30 min /
1 h / 2 h », 30 min par défaut, `behavior.sleepTabsAfter`) perd sa page : sa `WebContentsView` est
détruite, il garde URL, titre, favicon **et** sa liste précédent/suivant. C'est exactement l'état
« déchargé » des onglets restaurés de la session (ADR-005) : `TabManager.discard` remet `view` à null
et le mécanisme existant (`wake` à l'activation) le recharge ; rien n'est dupliqué. Au réveil, la liste
précédent/suivant est restaurée (`navigationHistory.restore`), sinon l'URL est simplement rechargée.

- Politique pure et testée (`src/main/sleep.ts`, `sleepBlocker`) : jamais un onglet à l'écran (actif,
  ou d'une vue scindée visible), qui joue du son (`isAudible`, même coupé), qui attend une réponse à une demande d'autorisation,
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
- **Téléchargements et zoom (ADR-013).** `hardenSession` passe le drapeau à
  `installDownloads(ses, { ephemeral })` : le fichier est enregistré où l'utilisateur l'a demandé, l'entrée
  apparaît dans la liste pendant la session mais `DownloadList.toJSON` l'exclut de `downloads.json` ;
  à la fermeture de la fenêtre, ses téléchargements en cours sont annulés et ses entrées retirées. Le zoom
  par site part des niveaux mémorisés, mais une fenêtre privée garde ses changements en mémoire
  (`isPrivateSession`, `src/main/zoom/`) : rien n'est écrit dans `zoom.json`. Toute nouvelle écriture
  « par session » doit faire de même.
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

## ADR-016 — Application mobile : Expo / React Native, code partagé avec le bureau

**Contexte.** Le navigateur doit exister sur iPhone et Android, avec une ergonomie pensée pour le
téléphone (« ultra mobile friendly ») et sans dupliquer la logique du bureau. Le développeur
travaille sous Windows et teste sur son téléphone.

**Contrainte iOS.** Sur iOS, tout navigateur doit afficher les pages avec WebKit (`WKWebView`) ;
les moteurs alternatifs ne sont autorisés que dans l'Union européenne, avec un programme dédié
d'Apple. Chromium/Electron n'est donc pas transposable : sur mobile, le moteur est la webview du
système (WebKit sur iOS, Android System WebView/Chromium sur Android), comme Safari, Arc Search,
DuckDuckGo ou Firefox iOS.

**Décision.** Une application **Expo / React Native** dans `mobile/` (SDK 58, React Native 0.88,
versions épinglées), un onglet = une `react-native-webview`.

- **Code partagé, jamais copié.** Metro (`watchFolders` + `resolveRequest`), TypeScript (`paths`)
  et Jest (`moduleNameMapper`) résolvent `@shared/*` vers `../src/shared`. Les dépendances
  importées depuis `src/shared` (assistants Babel) sont résolues dans `mobile/node_modules`, jamais
  dans celui du bureau. Les modules purs utiles aux deux ont été déplacés dans `src/shared` :
  `hosts.ts`, `https-only.ts` (ADR-007) et `history.ts` (ADR-005). Le mobile réutilise ainsi
  `normalizeInput`/`isNavigableUrl`/`SEARCH_ENGINES`, le classement de l'historique
  (`rankHistory`, `topSites`, `mergeSuggestions`) et la classe `History`, la recherche floue et
  `buildPalette` (feuille de recherche), le registre `commands.ts` (filtré aux commandes qui ont un
  sens sur téléphone), `sanitizeSettings` et le moteur de thème OKLCH (`derivePalette`, couleurs
  translucides converties en `rgba()` pour React Native), `spaces.ts`. `src/shared` doit rester pur.
- **Phase 1 : Expo Go.** Uniquement des modules inclus dans Expo Go (webview, gesture-handler 3,
  reanimated 4/worklets, safe-area, keyboard-controller, expo-haptics/blur/linear-gradient/clipboard/
  system-ui, AsyncStorage, svg) : l'application se lance sur un téléphone avec `npx expo start` et
  un QR code, sans Mac ni Android Studio.
- **Persistance.** AsyncStorage, documents versionnés `{ version, data }` comme sur le bureau
  (session sans les onglets privés, historique plafonné à 3 000 URL, favoris, paramètres),
  écritures regroupées et forcées au passage en arrière-plan. Restauration paresseuse : seuls
  l'onglet actif et les 4 derniers utilisés gardent une WebView montée ; les autres gardent
  URL/titre et se rechargent quand on y revient (les onglets privés iOS restent montés, leurs
  cookies vivant dans la WebView).
- **Sécurité des WebViews.** Navigation limitée à `http(s)`, `about:`, `data:` (`isNavigableUrl`
  dans `onShouldStartLoadWithRequest`) ; `mailto:`/`tel:`/`sms:` (cadre principal seulement)
  confiés au système ; HTTPS uniquement avec la même fonction pure que le bureau, appliquée aussi
  aux chargements explicites (la WebView ne consulte pas `onShouldStartLoadWithRequest` pour sa
  source initiale) et page « Connexion sécurisée indisponible » si la version https échoue
  (codes d'erreur propres à iOS et Android) ; `allowFileAccess`, `allowFileAccessFromFileURLs`,
  `allowUniversalAccessFromFileURLs` désactivés, `mixedContentMode="never"`,
  `javaScriptCanOpenWindowsAutomatically` désactivé, nouvelles fenêtres ouvertes en onglet
  (`setSupportMultipleWindows` + `onOpenWindow`, URL revalidée), géolocalisation désactivée,
  cookies tiers refusés (Android).
- **Seul pont page → application : l'appui long sur un lien.** Aucune webview n'offre de menu de
  lien commun aux deux plateformes ; un script injecté (cadre principal, lecture seule) détecte un
  appui long sur un `<a href>` et poste son URL. Le message est traité comme une entrée hostile
  (n'importe quelle page peut appeler `ReactNativeWebView.postMessage`) : forme stricte, URL http(s)
  uniquement, tailles bornées, onglet actif seulement, une fois par 800 ms ; il ne peut
  qu'**afficher** un menu, chaque action demande un toucher de l'utilisateur. Rien n'est renvoyé
  à la page. Limite : la présence de `window.ReactNativeWebView` est détectable par les pages.
- **Navigation privée.** iOS : `incognito` donne à chaque onglet privé un `WKWebsiteDataStore`
  non persistant (cookies isolés, effacés à la fermeture). Android : `incognito` de
  react-native-webview appelle `CookieManager.removeAllCookies` (global), ce qui déconnecterait
  l'utilisateur de tous ses sites ; il n'est donc pas utilisé. Les onglets privés Android n'ont ni
  historique, ni session, ni cache, ni formulaires, mais partagent les cookies (dit dans
  l'interface). Isolation réelle en phase 2 (profils `WebViewCompat`/`ProfileStore`).
- **Ergonomie.** Barre d'adresse et outils en bas (zone du pouce), repli en nom de domaine au
  défilement (logique pure `nextCollapse`), balayage horizontal de la barre pour changer d'onglet
  et vers le haut pour la vue des onglets, transition zoom page ↔ carte calculée (géométrie de la
  grille pure et testée, pas de mesure), retours haptiques, respect de « réduire les animations »
  et des zones sûres. Retour arrière : geste de bord natif sur iOS
  (`allowsBackForwardNavigationGestures`), bouton/geste retour du système sur Android
  (`BackHandler`, qui ferme d'abord feuilles et vues). Pas de miniatures (pas de
  `react-native-view-shot` dans Expo Go) : cartes à l'icône et aux couleurs du site. Les favicons
  viennent du site lui-même (`/favicon.ico`), jamais d'un service tiers, et pas du tout pour les
  onglets privés.
- **Bloqueur de contenu : phase 2, pas de simulacre.** Un vrai blocage demande du natif :
  `WKContentRuleList` (règles compilées par WebKit, format Safari Content Blocker) sur iOS,
  `shouldInterceptRequest` sur Android. Plan : *development build* (`expo-dev-client`, EAS Build) et
  un module Expo local (`modules/content-blocker`) avec plugin de configuration : conversion des
  listes EasyList/EasyPrivacy (moteur `@ghostery/adblocker`, déjà utilisé sur le bureau) en
  `WKContentRuleList` compilées et mises en cache, et sur Android un `WebViewClient` qui interroge
  le moteur sérialisé pour chaque requête. Le même module servira à isoler les onglets privés
  Android, à effacer les cookies et, plus tard, aux extensions (Safari Web Extensions n'étant pas
  disponibles dans une `WKWebView`, il s'agira d'un sous-ensemble maison). Les paramètres
  l'annoncent comme « bientôt » ; rien n'est simulé.

**Conséquences.** Deux moteurs selon la plateforme (inévitable sur iOS), mais une seule logique
métier testée. Toute fonction utile aux deux doit vivre, pure, dans `src/shared` ; le bureau ne
compile pas `mobile/` (tsconfig/vitest inchangés) et la CI mobile (`.github/workflows/mobile.yml`)
vérifie types, tests Jest et bundle Android dès que `mobile/` ou `src/shared` change.

## ADR-018 — Synchronisation chiffrée de bout en bout

**Contexte.** Retrouver sur le téléphone ses favoris, son historique récent, ses espaces et ses
onglets du PC (et inversement), sans confier sa navigation à un tiers : le projet se veut privé, et
le propriétaire héberge lui-même le serveur.

**Décision.** Un relais minimal auto-hébergé (`server/`) qui ne stocke que des données chiffrées
sur les appareils, et un moteur de synchronisation pur partagé par les deux applications
(`src/shared/sync/`). Désactivé par défaut : aucun serveur n'est contacté tant que l'utilisateur n'a
pas créé un compte sur *son* serveur ou jumelé l'appareil ; aucun serveur tiers n'est codé en dur.

### Modèle de menace

- **Protégé contre** l'hébergeur du relais, une sauvegarde volée de ses données, un attaquant qui lit
  le trafic (TLS par le proxy inverse, en plus du chiffrement de bout en bout) : ils ne peuvent ni
  lire ni modifier sans détection (AEAD) les enregistrements, ni déplacer un enregistrement d'une
  collection ou d'un identifiant à un autre (données associées), ni tester une URL devinée contre
  les identifiants (HMAC à clé).
- **Non protégé contre** un appareil jumelé compromis (il a la clé), quelqu'un qui voit le code de
  jumelage (accès complet : il n'est affiché qu'à la demande, après un avertissement, jamais pendant
  la synchronisation elle-même), un relais malveillant qui *supprime*, rejoue d'anciennes versions
  ou refuse le service (disponibilité et fraîcheur ne sont pas garanties ; une ancienne version
  rejouée perd contre l'horodatage plus récent que les appareils ont déjà vu), l'analyse de trafic.

### Cryptographie et clés

- `@noble/ciphers` et `@noble/hashes` (JavaScript pur, audités, sans dépendance) : le même code
  tourne dans le process principal d'Electron et dans Hermes (Expo Go n'a pas WebCrypto `subtle`).
  L'aléa est injecté : `crypto.randomBytes` (bureau), `expo-crypto` `getRandomBytes` (mobile),
  vérifié (longueur, pas de zéros).
- **Clé de synchronisation** : 256 bits aléatoires créés sur le premier appareil. HKDF-SHA256
  (sel `browser-sync/v1`) en dérive une clé de chiffrement, une clé d'identifiants et une empreinte
  courte affichée dans les paramètres (même valeur sur tous les appareils d'un compte).
- **Enregistrements** : XChaCha20-Poly1305, nonce aléatoire de 192 bits (sûr avec des nonces
  aléatoires), données associées `browser-sync/v1|collection|id`. Enveloppe : octet de version,
  nonce, chiffré + tag, en base64url. Le clair contient l'identifiant local, qui doit redonner
  l'identifiant serveur par HMAC (un enregistrement ne peut pas être déplacé).
- **Identifiants** : HMAC-SHA256(clé d'identifiants, collection + identifiant local) tronqué à
  128 bits. L'identifiant local d'un favori ou d'une page d'historique est son URL : elle ne quitte
  jamais l'appareil, même hachée sans clé.
- **Jumelage** : `browser-sync:1:<base64url(JSON)>` avec l'adresse du serveur, l'identifiant du
  compte, le jeton d'accès et la clé. QR code dessiné localement (`uqr`, pur JS, aucun réseau) et
  texte copiable ; scanné sur le téléphone avec `expo-camera` (inclus dans Expo Go), collé sur un PC.
  `https` obligatoire, `http` accepté seulement pour une adresse locale (essai à la maison, tests).
- **Stockage des secrets** : bureau, `sync-credentials.json` chiffré par `safeStorage` (Trousseau,
  DPAPI, libsecret/kwallet), sinon fichier 0600 ; mobile, `expo-secure-store` (Keychain iOS
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Keystore Android). L'état du moteur (`sync.json`, AsyncStorage)
  ne contient ni clé ni jeton.
- **Réinitialiser** (code perdu, appareil volé) : le compte est supprimé du serveur puis recréé avec
  un nouveau jeton et une nouvelle clé ; les autres appareils reçoivent 401 et doivent être jumelés
  à nouveau. **Déconnecter** : l'appareil publie la suppression de sa fiche (onglets) puis oublie
  le compte ; ses données locales restent.

### Ce que voit le serveur

Pour chaque compte : un identifiant aléatoire, le haché SHA-256 du jeton, la date de création ; par
enregistrement : le nom de la collection (`settings`, `spaces`, `bookmarks`, `history`, `clients`),
l'identifiant haché, un numéro de version, la date d'écriture, la taille du chiffré, et si
l'enregistrement a été retiré (expiré). Il en déduit le nombre approximatif de favoris, de pages
d'historique et d'appareils, et les heures d'activité. Il ne voit ni URL, ni titre, ni nom
d'appareil, ni réglage. Ses journaux ne contiennent ni identifiant, ni jeton, ni adresse IP.

### Données et fusion

- **Synchronisé** : favoris et dossiers (identifiés par URL : la même page enregistrée sur deux
  appareils est un seul favori), historique des 90 derniers jours (5 000 pages au plus, nombre de
  visites et dernière visite fusionnés par maximum), onglets ouverts de chaque appareil (100 au plus,
  http(s) seulement), définition des espaces (nom, icône comme chaîne opaque, couleur, isolement,
  ordre ; jamais leurs onglets), réglages communs (mode de thème, accents, moteur de recherche,
  page d'accueil). **Non synchronisé** : disposition et fenêtre, téléchargements, zoom, boucliers,
  permissions, réglages propres au bureau ou au téléphone, favicons.
- **Navigation privée** : jamais rien. Les fenêtres et onglets privés n'écrivent pas d'historique,
  ne sont pas dans la session et ne sont pas publiés dans la liste d'onglets (testé de bout en bout) ;
  le compte ne peut être ni créé, ni jumelé, ni réinitialisé depuis une fenêtre privée, et le code de
  jumelage n'y est pas affiché. Seule exception, conforme à l'ADR-014 : un favori enregistré
  explicitement depuis une fenêtre privée est un favori du profil, synchronisé comme les autres.
- **Dernier écrivain gagnant, par enregistrement**, avec une horloge logique hybride (HLC : temps
  réel + compteur, identifiant d'appareil pour départager) ; les suppressions sont des pierres
  tombales chiffrées. Le moteur détecte les changements locaux en comparant chaque collection à un
  *miroir* (haché par enregistrement) de ce qui a été synchronisé, si bien que les applications
  n'ont qu'à signaler « quelque chose a changé ». Premier passage d'une collection sur un appareil
  qui rejoint un compte : les données du compte gagnent, les enregistrements purement locaux sont
  ajoutés (un téléphone neuf ne remplace pas le thème du PC par les valeurs par défaut).
- Une page d'historique qui sort de la fenêtre de 90 jours (ou d'un historique local plein) n'est
  pas une suppression : elle est retirée du serveur (`payload: null`) sans être effacée ailleurs.
  « Effacer l'historique » en est une, propagée à tous les appareils.
- **Protocole** : tirage incrémental depuis la dernière version vue, puis envoi par lots (200
  enregistrements, 2 Mo) avec concurrence optimiste : chaque enregistrement porte la version qu'il
  remplace ; si l'une a changé, le serveur répond 409 sans rien écrire, l'appareil retire, fusionne
  et renvoie (3 essais). Pages de 500 au tirage. Enregistrements indéchiffrables : ignorés, et si une
  page entière l'est (autre clé), arrêt sans avancer le curseur.
- **Quand** : au démarrage, 5 s après un changement local (plafonné à 30 s d'activité continue),
  toutes les 5 minutes, au retour au premier plan sur mobile, et à la demande (bouton, commande
  « Synchroniser maintenant »). Hors ligne, erreurs serveur et 429 : nouvel essai avec délai
  exponentiel (15 s à 15 min, `Retry-After` respecté) ; jeton refusé ou clé différente : arrêt et
  message dans les paramètres.

### Serveur

Node 22 et TypeScript sans dépendance d'exécution (`node:http`, `node:crypto`). `node:sqlite`
étant encore expérimental dans Node 22, les données sont un fichier JSON par compte, écrit de
façon atomique avant de répondre (volumes de quelques Mo). Jeton haché, comparaison à temps
constant ; limite de requêtes par adresse (et de créations de comptes par heure) ; corps limités à
2 Mo, enveloppes à 256 Ko, quota de 64 Mo par compte ; **pas de CORS**, et toute requête portant un
en-tête `Origin` (donc venant d'une page web) est refusée ; code d'inscription facultatif
(`REGISTRATION_SECRET`) pour réserver la création de comptes. TLS attendu d'un proxy inverse.
Dockerfile et guide de déploiement (VPS + Caddy, Fly.io, Render) dans `server/README.md`.

### Intégration

- Bureau : `src/main/sync/` (adaptateurs du profil, `net.fetch` d'Electron pour le proxy et les
  certificats du système, secrets), IPC `sync:*` validés (règles de l'ADR-003), section
  « Synchronisation » des paramètres (état, appareils et leurs onglets, code de jumelage derrière un
  avertissement, déconnexion, réinitialisation), section « Onglets de mes autres appareils » de la
  palette `Ctrl+K`, commande « Synchroniser maintenant » du registre.
- Mobile : `mobile/src/lib/sync/` (adaptateurs purs testés avec un serveur en mémoire), section
  « Synchronisation » des paramètres, scanner de QR code, section « Autres appareils » dans la vue des
  onglets et dans la recherche.
- Tests : moteur (matrice de conflits, 409, pagination, hors ligne, clé différente, aucun clair sur
  le serveur), contrôleur, enregistrements, serveur (Vitest) ; adaptateurs mobiles et
  interopérabilité bureau/mobile (Jest) ; e2e avec le vrai relais et deux instances du bureau
  (jumelage, favori, onglets, fenêtre privée absente, aucun clair dans les fichiers du serveur).

**Limites.** Pas de fusion fine (un titre modifié en même temps sur deux appareils : le plus récent
gagne entièrement) ; un appareil dont l'horloge avance gagne les conflits (dérive bornée à 24 h dans
l'horloge, pas dans la comparaison) ; les changements faits hors ligne prennent l'heure de leur
première synchronisation ; pas de rotation de clé sans réinitialisation, ni de révocation d'un seul
appareil (il faut réinitialiser) ; pas de favicons ; l'historique n'est qu'une ligne par URL ;
`expo-camera` et le chiffrement n'ont été exécutés que dans les tests (Node/Jest) et dans le bundle
Hermes compilé, pas encore sur un vrai téléphone.
