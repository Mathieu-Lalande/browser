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
