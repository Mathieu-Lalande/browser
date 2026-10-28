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
  (`window.browser`) est exposée par le preload. CSP stricte (`img-src 'self' data:` : l'interface ne
  charge aucune image distante, ADR-018). Servie depuis `app://browser/` (schéma privilégié, ADR-018),
  plus depuis `file://`.
- Pages web : `WebContentsView` sandboxées, sans preload, `webSecurity` actif, pas de `<webview>`.
- Les pages ne peuvent charger que `http(s)`, `about:` et `data:` ; `file:` / `javascript:` / `app:` sont refusés.
  Une page ne peut **ouvrir** (`window.open`, `target=_blank`) que `http(s)` et `about:blank`
  (`isPageOpenableUrl`), et seulement juste après un geste de l'utilisateur (bloqueur de fenêtres, ADR-018).
- Les permissions sensibles (caméra, micro, géoloc, notifications…) sont demandées site par site via une
  barre d'autorisation dans l'interface (décisions mémorisables par couple origine demandeuse / origine
  de premier niveau, ADR-018) ; seules les origines https
  (ou localhost) peuvent les demander. Le reste est refusé (voir ADR-008).
- Chaque message IPC est validé et n'est accepté que s'il provient d'une fenêtre du navigateur.

## ADR-004 — Moteur de recherche par défaut

DuckDuckGo par défaut (cohérent avec « privé ») ; Brave Search, Startpage et Google proposés.

## ADR-005 — Persistance en fichiers JSON

**Décision.** Session, historique et favoris sont des fichiers JSON dans le dossier de profil
(`userData`, ou `BROWSER_PROFILE_DIR` hors paquet — `--user-data-dir` sinon, ADR-018) : `session.json`,
`history.json`, `bookmarks.json`. Les favicons n'y sont que des `data:` d'au plus 16 Ko (ADR-018) ; une
visite dont l'URL dépasse 8 Ko n'est pas enregistrée.
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
- crochet de test : `BROWSER_TEST_FILTERS=<fichier>` remplace les listes téléchargées par une liste locale
  (ignoré par l'application empaquetée, ADR-018).

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
  Les décisions sont indexées par (origine demandeuse, origine de premier niveau) : un cadre intégré
  autorisé dans un site ne l'est pas ailleurs, et la barre affiche « X (intégré dans Y) » (ADR-018).
  Seules les origines https (ou localhost) peuvent demander quoi que ce soit ; `fullscreen`, `pointerLock`
  et `clipboard-sanitized-write` restent accordées d'office. Limite connue : `getDisplayMedia` demande
  encore un sélecteur d'écran (`setDisplayMediaRequestHandler`), non implémenté.
- **Global Privacy Control.** En-tête `Sec-GPC: 1` sur les requêtes des onglets. `navigator.globalPrivacyControl`
  n'est pas exposé : il faudrait injecter du code dans la page avant ses scripts (preload).
- **Cookies tiers.** Electron n'offre pas de réglage de session pour les bloquer ; filtrer les en-têtes
  `Cookie`/`Set-Cookie` à la main serait partiel (`document.cookie` des iframes) et casserait des
  connexions (SSO). Fait depuis en option, désactivée par défaut, avec exceptions par site (ADR-021).
- **WebRTC.** Politique `default_public_interface_only` sur chaque onglet : les pages ne voient pas les
  adresses IP locales.

## ADR-009 — Espaces (sessions partitionnées) et vue scindée

**Espaces.** Un espace = nom, icône (nom d'icône Lucide, voir ADR-017), couleur (facultative), onglets propres (épinglés compris) et
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
  d'édition dans la barre latérale (nom, grille d'icônes, couleur, isolement, suppression confirmée). La
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
  apparaître la barre, qui se masque peu après que la souris l'a quittée. Animation et bande de
  déplacement : ADR-020.

## ADR-012 — Pages internes `browser://`

**Décision.** Les pages du navigateur (`browser://settings`) sont des onglets ordinaires dont le
contenu est dessiné par l'interface, sans `WebContentsView` (comme la page d'accueil, qui reste
l'URL vide pour la compatibilité des sessions). Elles sont restaurées avec la session.

- Seul l'utilisateur peut les ouvrir : `normalizeInput` (barre d'adresse, menus) reconnaît les pages
  connues ; `isNavigableUrl` refuse le schéma `browser:`, donc une page web ne peut ni y naviguer,
  ni l'ouvrir dans un nouvel onglet, ni y être redirigée (testé en unitaire et en e2e).
- Elles ne passent jamais par l'historique ni les favoris.
- Ouvrir la page d'accueil ou une page interne dans un onglet qui affiche une page web ne navigue pas
  la vue : elle est détachée et gardée telle quelle (historique compris). « Précédent » la rattache,
  « Suivant » revient alors à la page interne, jusqu'à ce que la page navigue ailleurs.

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
  `.ps1`, `.jar`, `.app`, `.dmg`, `.pkg`, `.deb`, `.sh`, `.AppImage`…, et depuis ADR-018 les listes
  « dangereux » et « autorisé sur geste » de Chromium : `.iso`, `.vhd`, `.html`, `.svg`, `.mht`, `.docm`,
  `.chm`, `.webloc`, `.mobileconfig`…, dernière extension, points et espaces finaux ignorés comme le
  fait Windows, caractères de format invisibles `\p{Cf}` — dont le RLO — retirés du nom — classification
  pure et testée) : téléchargés sous un nom
  neutre (`<id>.download`) dans `userData/Unconfirmed downloads`, jamais dans le dossier de l'utilisateur
  sous leur vrai nom. Ils restent « à confirmer » : « Conserver » (une fois terminés) les déplace vers le
  dossier sous un nom unique, « Supprimer » les efface. Au redémarrage, ce qui n'a pas été confirmé est
  supprimé (l'entrée revient « Annulé »).
- **Rien ne s'ouvre tout seul.** « Ouvrir » (`shell.openPath`) n'est proposé qu'à un fichier terminé et
  confirmé **d'un type sûr** (`canOpenFile` : PDF, images, audio/vidéo, texte/CSV/Markdown, documents
  bureautiques sans macros ; ni archives, ni HTML/SVG, ni macros, ni images disque — ADR-018), revérifié
  dans main ; pour le reste seul « Afficher dans le dossier » (`shell.showItemInFolder`) est proposé. L'interface ne désigne un
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
- Crochet de test : `BROWSER_TEST_SLEEP_MS` remplace le délai (sauf « Jamais » ; ignoré une fois empaqueté, ADR-018).

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
  apparaît dans la liste **de cette fenêtre seulement** (les fenêtres normales ne la voient ni ne la
  reçoivent, ADR-018) mais `DownloadList.toJSON` l'exclut de `downloads.json` ;
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
- Test de fumée du paquet (`tests/e2e/packaging.spec.ts`, ignoré sans `BROWSER_PACKAGED`) : fusibles
  Electron lus dans le binaire, code, interface et worker présents dans `app.asar` (et pas de dossier
  `app/`), puis l'app empaquetée démarre, affiche sa fenêtre et l'overlay depuis `app://`, charge une page
  filtrée, et ignore les crochets de test. Les fusibles coupant l'inspecteur Node (ADR-018), le pilote
  Electron de Playwright ne peut plus s'y attacher : le test pilote l'app par le protocole DevTools de
  Chromium (`--remote-debugging-port`), pages seulement ; le moteur de filtres est préparé dans le
  profil (`--user-data-dir`). Le chargement du worker depuis l'archive n'est plus exécuté dans ce test.
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
- **Sécurité des WebViews.** Nouvelles fenêtres limitées à `http(s)` et `about:blank`
  (`decideOpenWindow`, ADR-018). Navigation limitée à `http(s)`, `about:`, `data:` (`isNavigableUrl`
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
  historique, ni session, ni cache, ni formulaires, mais partagent les cookies (dit explicitement dans
  l'interface : « Cookies partagés avec les onglets normaux sur Android »). Isolation réelle en phase 2 (profils `WebViewCompat`/`ProfileStore`).
- **Ergonomie.** Barre d'adresse et outils en bas (zone du pouce), repli en nom de domaine au
  défilement (logique pure `nextCollapse`), balayage horizontal de la barre pour changer d'onglet
  et vers le haut pour la vue des onglets, transition zoom page ↔ carte calculée (géométrie de la
  grille pure et testée, pas de mesure), retours haptiques, respect de « réduire les animations »
  et des zones sûres. Retour arrière : geste de bord natif sur iOS
  (`allowsBackForwardNavigationGestures`), bouton/geste retour du système sur Android
  (`BackHandler`, qui ferme d'abord feuilles et vues). Pas de miniatures (pas de
  `react-native-view-shot` dans Expo Go) : cartes neutres (surface du thème, favicon du site ou son initiale en gris, ADR-017). Les favicons
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

## ADR-017 — Icônes : Lucide partout, aucun emoji

**Contexte.** L'interface mélangeait des tracés SVG dessinés à la main, des emojis (icônes des
espaces, menus) et des tuiles de site colorées selon l'hôte. Le propriétaire veut une application
qui « fait pro » : un seul jeu d'icônes, dont la couleur vient du CSS, et aucun emoji.

**Décision.**
- **Lucide** sur les deux applications : `@lucide/svelte` (bureau, Svelte 5) et
  `lucide-react-native` (mobile, sur `react-native-svg` déjà inclus dans Expo Go), versions
  épinglées. Chaque icône est importée individuellement (`@lucide/svelte/icons/<nom>`,
  `lucide-react-native/icons/<nom>`) : seul ce qui est utilisé est embarqué.
- Les composants `Icon` (`src/renderer/src/components/Icon.svelte`, `mobile/src/components/Icon.tsx`)
  restent la seule porte d'entrée : ils associent les noms de l'interface (et `CommandIcon`) à un
  composant Lucide, si bien que les appels ne changent pas. Couleur : `currentColor` (bureau) ou une
  couleur du thème (mobile) ; jamais de couleur codée en dur. Trait 2 (bureau, icônes de 12 à 20 px)
  et 1,75 (mobile, 20 à 24 px) ; tailles sur la grille de 4 px.
- **Espaces.** `SpaceInfo.icon` est un nom d'icône Lucide pris dans une liste de 32
  (`SPACE_ICONS`, `src/shared/spaces.ts`, libellés français dans `SPACE_ICON_LABELS`) ; l'IPC refuse
  toute autre valeur. Au chargement, `sanitizeSpace` → `migrateSpaceIcon` convertit les emojis des
  versions précédentes (session.json v2 du bureau, AsyncStorage du mobile ; 🏠 → `circle-user`,
  💼 → `briefcase`…) et remplace toute valeur inconnue par `star`, sans changer de version de
  fichier (la migration est idempotente). Les fenêtres privées ont l'icône `venetian-mask`, jamais
  proposée. Les menus natifs (« Déplacer vers l'espace ») n'affichent que le nom.
- **Sites sans favicon.** Tuile neutre : surface du thème, bordure fine, globe (bureau) ou initiale
  du site (mobile) dans la couleur de texte atténuée. L'accent ne sert qu'aux états actif/sélectionné.
  Les vrais favicons, logos des sites, restent tels quels. Les cartes de la vue des onglets mobile
  n'ont plus de dégradé coloré par site.
- Les glyphes de raccourcis clavier (⌘ ⇧ ⌥ ↵ ← →) restent : ce sont des caractères
  typographiques, pas des icônes.

## ADR-018 — Durcissement post-audit

**Contexte.** Un audit de sécurité a relevé une fuite des favicons hors de la session de l'onglet, des
fenêtres surgissantes sans geste (dont des documents `data:`), l'absence de fusibles Electron, des
lacunes de la liste des téléchargements dangereux, une croissance non bornée de l'historique et
quelques crochets de test actifs en production. Chaque point a son test de régression
(`tests/e2e/hardening.spec.ts`, tests unitaires associés).

- **Favicons** (`src/main/favicons.ts`, règles pures `src/shared/favicon.ts`). L'interface n'affiche plus
  l'URL déclarée par la page avec un `<img>` chargé par la session par défaut (une fenêtre privée ou un
  espace isolé y laissait requête, cookies et cache, hors boucliers, HTTPS-Only et GPC). Main la
  récupère avec la **session de l'onglet** (`ses.fetch`, cookies de cette session, `Sec-GPC`, mise à
  niveau HTTPS-Only, refus si les boucliers bloquent l'image pour cette page), n'accepte que http(s) ou
  un `data:` base64, un type image matriciel (pas de SVG), 64 Ko et 5 s au plus, et met un `data:` dans
  `TabState.favicon`. Cache par onglet et par page (clé page + candidats) et par session (200 entrées,
  oublié à la fermeture d'une fenêtre privée). Historique, favoris et `session.json` ne gardent qu'un
  `data:` de 16 Ko au plus ; les favicons http(s) déjà enregistrés sont retirés au chargement (migration
  par le validateur, sans changement de version). Une fenêtre privée n'écrit de favicon nulle part (pas
  d'historique, favori enregistré sans favicon).
- **CSP de l'interface** : `img-src 'self' data:` (chrome et overlay). L'image de fond de la page
  d'accueil (URL https choisie dans les paramètres) est récupérée par main dans une session dédiée **en
  mémoire et sans cookies** (`browser-assets`, `src/main/start-image.ts`, 8 Mo, image matricielle) et
  transmise en `data:` (IPC `settings:start-image`, l'URL vient des paramètres, jamais du renderer).
  Décision : les fenêtres privées ne l'affichent pas (thème privé fixe, aucune requête de leur fait).
- **Fenêtres surgissantes** (`src/main/activation.ts`, pur et testé ; `security.ts`). `isPageOpenableUrl`
  (`http`, `https`, `about:blank`) remplace `isNavigableUrl` pour `window.open`, la défense en profondeur
  de `openTab` et `onOpenWindow` sur mobile : plus jamais de document `data:` de premier niveau ouvert
  par une page. Bloqueur : main note la dernière entrée de confiance de chaque onglet
  (`before-mouse-event` / `before-input-event` : appui souris, touche — pas les modificateurs seuls ni la
  répétition ; le tactile arrive en événements souris/gestes) ; une ouverture n'est permise que dans la
  seconde qui suit, **une par geste**. `disposition` n'autorise rien (un script peut poser des
  modificateurs sur un clic synthétique) : il choisit seulement premier/arrière-plan. Une fenêtre bloquée
  s'annonce dans une bande au-dessus de la page (`PopupBar`, comme la barre d'autorisation) :
  « Fenêtre surgissante bloquée », « Ouvrir » (main garde l'URL, le renderer ne désigne que l'onglet),
  « Ignorer » ; effacée à la navigation suivante.
- **`mailto:` / `tel:`** : seulement après un geste (le même, partagé avec les fenêtres) et au plus une
  fois toutes les 3 s par onglet.
- **Interface sur `app://`** (`src/main/app-protocol.ts`, règles pures `app-files.ts`). Schéma
  `app://browser/` enregistré comme privilégié (standard, sécurisé, fetch) et servi par
  `protocol.handle` sur la session par défaut : fichiers de `out/renderer` uniquement (chemin résolu et
  vérifié sous la racine, séparateurs encodés refusés, types MIME connus seulement, `nosniff`). Les pages
  d'onglets ne peuvent ni y naviguer (`isNavigableUrl`), ni l'ouvrir, ni le requêter (le pipeline de
  confidentialité annule leurs requêtes `app:`). `ELECTRON_RENDERER_URL` (serveur Vite) n'est suivi que
  si `!app.isPackaged`.
- **Fusibles Electron** (`build.electronFuses`, pris en charge par electron-builder 26) : `runAsNode`,
  `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`,
  `grantFileProtocolExtraPrivileges` désactivés ; `enableCookieEncryption`,
  `enableEmbeddedAsarIntegrityValidation` (macOS/Windows), `onlyLoadAppFromAsar` activés. Le
  chiffrement des cookies passe par le trousseau de l'OS ; sous Linux sans trousseau (CI, xvfb),
  Chromium se rabat sur son magasin « basic » : l'app démarre (vérifié par le test de fumée). Vérifier
  avec `npx @electron/fuses read --app release/linux-unpacked/browser`.
- **Crochets de dev et de test** : `BROWSER_PROFILE_DIR`, `BROWSER_TEST_FILTERS`, `BROWSER_TEST_SLEEP_MS`
  et `ELECTRON_RENDERER_URL` ne sont lus que si `!app.isPackaged`. Un profil séparé s'obtient alors avec
  l'option de Chromium `--user-data-dir=<dossier>` (suivie par Electron). `--no-sandbox` reste accepté
  (certaines distributions ne peuvent pas lancer le bac à sable) mais une application empaquetée l'écrit
  en avertissement.
- **Téléchargements** : liste dangereuse alignée sur Chromium, `\p{Cf}` retiré des noms, « Ouvrir »
  réservé à une liste blanche de types (ADR-013). Les entrées d'une fenêtre privée portent la clé de sa
  session : elle seule les voit et les reçoit, les fenêtres normales ne voient que celles du profil, et
  chaque action IPC vérifie cette visibilité.
- **Historique** : pas de visite pour une URL de plus de 8 Ko ; visites dans la page (pushState) limitées
  à une par seconde et par onglet, URL distinctes seulement (une rafale de pushState n'en enregistre
  qu'une). `JsonFile` sérialise dans son `try` (une donnée non sérialisable est signalée, pas levée) et un
  instantané qui lève est signalé ; `flush()` du profil écrit chaque fichier dans son propre `try`.
- **Permissions** : clé `"<origine>"` quand l'origine demandeuse est le site de premier niveau (format
  inchangé : les anciennes décisions valent désormais pour ce seul cas), sinon
  `"<origine demandeuse> <origine de premier niveau>"` ; les clés invalides sont abandonnées au chargement.
- **Mobile** : `onOpenWindow` passe par `decideOpenWindow` (même règle que le bureau) ;
  `allowContentAccess` n'est pas une prop de react-native-webview 14, qui le met déjà à `false` pour
  chaque WebView Android (vérifié dans `RNCWebViewManagerImpl`, à revérifier aux mises à jour) ; le
  libellé privé Android dit « Cookies partagés avec les onglets normaux sur Android ».

**Limites.** L'activation utilisateur est approchée depuis main (l'entrée de confiance la plus récente) :
une page peut utiliser un clic de l'utilisateur sur elle, dans la seconde, pour ouvrir *un* onglet
qu'il n'a pas demandé, comme dans Chromium. Une rafale de pushState n'enregistre pas la dernière URL
de la rafale si elle arrive dans la même seconde.

## ADR-019 — Synchronisation chiffrée de bout en bout

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

## ADR-020 — Ergonomie de l'interface : fenêtre, clavier, erreurs, contraste

**Contexte.** Un audit UX/UI a relevé des défauts d'ergonomie : onglets écrasés au lieu de défiler,
pas de boutons de fenêtre ni de zone de déplacement une fois la barre latérale masquée (fenêtre sans
cadre sous Linux/Windows), page blanche pour un site injoignable, couleurs d'espace qui contournaient
le moteur de contraste, raccourcis affichés de trois façons différentes.

**Décisions.**
- **Boutons de fenêtre** (Windows/Linux, `frame: false`) : réduire / agrandir-restaurer / fermer,
  icônes Lucide (`minus`, `square`, `copy`), 36×30 px, fermer rouge au survol, au **coin extérieur
  haut-droit** de la fenêtre : dans une barre déplaçable au-dessus de la page (barre latérale à gauche
  ou masquée, qui y place aussi son bouton « Afficher »), dans l'en-tête de la barre latérale quand elle
  est à droite ou révélée en mode zen. L'état agrandi vient de main (`window:maximized`). macOS garde
  ses feux tricolores : une marge de 72 px (en-tête de la barre latérale à gauche, barre de fenêtre
  quand elle est masquée) ou une bande de 36 px (barre à droite) les isole ; main les masque en mode zen.
  `<html data-platform>` pilote cette disposition (une e2e simule macOS en le changeant).
- **Mode zen** : une bande de déplacement de 8 px reste en haut de la page. La barre révélée glisse
  (largeur animée, 180 ms) au lieu d'apparaître d'un coup ; l'interface envoie au plus **une mise à jour
  des limites de la page par image** (`requestAnimationFrame`, valeurs identiques ignorées), si bien que
  la vue native suit l'animation sans rafale d'IPC. *Compromis* : la page native ne peut pas passer
  sous la barre (ADR-010) ; elle est donc redimensionnée pendant ~11 images, ce qui coûte quelques mises
  en page à une page lourde, mais évite le saut brutal. « Réduire les animations » supprime l'animation.
- **Erreurs de chargement** : `did-fail-load` (cadre principal, hors `-3` et hors codes déjà traités
  par HTTPS-Only) pose `TabState.loadError = { code, description, url }` ; la vue est détachée et
  l'interface affiche `LoadErrorPage` (même mécanisme que l'interstitiel HTTPS-Only), avec un message
  par famille d'erreur (`src/shared/load-error.ts`, pur et testé : DNS, hors ligne, refus, coupure,
  délai, certificat, redirections, port bloqué…), « Actualiser » et les détails. Effacé à la navigation suivante.
- **Couleurs d'espace** : `accentVariables(color, mode)` (`src/shared/theme.ts`) borne la luminosité
  OKLCH de la couleur choisie (0,38–0,82) et dérive `--accent`, `--accent-text` (≥ 4,5:1) et
  `--on-accent` comme pour l'accent du thème ; testé avec des couleurs extrêmes (#fff200, #101010…).
  Partout où le contraste compte (focus, bordures sélectionnées, textes et icônes d'accent), l'interface
  utilise `--accent-text`, jamais l'accent brut.
- **Clavier** : la liste des onglets est un `tablist` vertical à un seul arrêt de tabulation
  (`tabindex` itinérant) : flèches, Début/Fin, Entrée/Espace, Suppr/Retour arrière. Les confirmations
  destructives (palette, données, réinitialisations des paramètres, suppression d'espace) donnent le
  focus à « Annuler ».
- **Raccourcis affichés** : construits depuis le registre (`shortcutText`, `commandShortcut`,
  `withShortcut`), une seule notation (« Ctrl+Maj+B », « ⇧⌘B »).
- **Onglets vides** : « Nouvel onglet », les paramètres et les téléchargements réutilisent un onglet
  « Page d'accueil » vide de l'espace au lieu d'en empiler (`BrowserController.newTab`).
- **Téléchargements** : « Réessayer » relance un téléchargement échoué ou interrompu depuis son URL
  d'origine, dans sa session (`session.downloadURL` ; seule exception à « seules les pages
  d'onglets téléchargent », pour une URL http(s) tirée de l'historique de main, jamais du renderer).

## ADR-021 — Essentiels : menu contextuel des pages, infos sur le site, données des sites

**Menu contextuel des pages** (`src/main/page-menu.ts`, modèle pur et testé `page-menu-model.ts`).
`webContents.on("context-menu")` (branché par `TabManager`, hook `contextMenu`) ouvre un menu natif
(`Menu.popup`, comme le menu des onglets : il passe au-dessus de la vue de la page). Les entrées
dépendent du clic : lien (nouvel onglet, arrière-plan, vue scindée, espace…, fenêtre privée, copier le
lien / son texte), image (ouvrir, copier, copier l'adresse, enregistrer), média (lecture/pause, muet,
boucle, image dans l'image), sélection (copier, rechercher avec le moteur choisi, « Ouvrir comme
adresse »), champ éditable (annuler… coller sans mise en forme, tout sélectionner, suggestions
orthographiques et « Ajouter au dictionnaire »), page (précédent, suivant, actualiser, enregistrer,
copier l'adresse, infos sur le site), et toujours « Inspecter ».
- Toute URL venue de la page repasse par `isPageOpenableUrl` (http, https, about:blank) avant d'être
  ouverte, et encore dans `page-menu.ts` au clic : jamais `file:`, `javascript:`, `data:` ni `browser:`.
  Un lien `javascript:` n'est pas proposé à la copie.
- « Enregistrer l'image / la page » : `webContents.downloadURL` dans la session de l'onglet, donc par
  `will-download` et les règles des fichiers dangereux (ADR-013) ; une page HTML enregistrée est
  « à confirmer ». Le libellé garde « sous… » ; la boîte de dialogue suit le réglage « Toujours demander ».
- Lecture/muet/boucle : court script dans un monde isolé (1003), sur l'élément sous le clic
  (coordonnées divisées par le zoom). Limite : médias dans des iframes non atteints.
- Fenêtres privées : pas d'« Ouvrir dans l'espace », pas d'« Ajouter au dictionnaire » (le
  dictionnaire est dans le profil). « Ouvrir dans une fenêtre privée » ouvre une **nouvelle** fenêtre
  privée ; rien ne va d'une fenêtre privée vers une fenêtre normale (seul le presse-papiers, sur
  action explicite).
- « Afficher le code source » n'est **pas** proposé : `view-source:` devrait devenir navigable, ce que
  `isNavigableUrl` refuse à dessein (ADR-003) ; « Inspecter » ouvre les DevTools sur l'élément.

**Infos sur le site** : popover du calque overlay (`OverlayKind` « site-info », `isPopover`), ouvert par
le cadenas de la barre d'adresse, la commande « Infos sur le site » (palette : `opensOverlay`, le
popover remplace la palette sans fermer le calque) ou le menu contextuel. L'interface ne désigne qu'un
onglet : main lit son URL et **sa** session (`src/main/site-info/`).
- Certificat : `session.setCertificateVerifyProc` (posé par `hardenSession`) répond toujours `-3`
  (« verdict de Chromium ») : il ne change jamais la confiance, il note le certificat (sujet, émetteur,
  validité, empreinte SHA-256) de chaque hôte vérifié avec succès, en mémoire, par session, 500 hôtes au
  plus. C'est la seule API d'Electron 44 qui donne le certificat d'une connexion réussie
  (`certificate-error` ne voit que les échecs). Une connexion reprise sans nouvelle vérification avant
  l'enregistrement affiche « Détails indisponibles ». http : « Connexion non sécurisée ».
- Cookies : nombre de cookies du site (domaine enregistrable, sous-domaines compris) dans la session de
  l'onglet. « Effacer les cookies et données du site » (confirmation) : chaque cookie retiré
  (`cookies.remove`), puis `clearStorageData({ origin })` pour l'origine de la page et, en http et https,
  le site, `www.` et chaque hôte des cookies ; puis l'onglet est rechargé. Limite : le stockage d'un
  sous-domaine sans cookie n'est pas atteint.
- Autorisations : décisions du magasin existant où le site est le site de premier niveau (les siennes et
  celles des cadres intégrés), réinitialisables une par une (`PermissionStore.forget`).
- Protections (compteur, interrupteur : `toggleShields`) et zoom (réinitialisation : `zoom-reset`)
  suivent l'état vivant de l'onglet.
- Fenêtre privée : sa session en mémoire, son magasin d'autorisations et ses boucliers éphémères ;
  l'exception aux cookies tiers (un réglage) n'y est pas modifiable.
- Domaine enregistrable : la liste des suffixes publics déjà embarquée par le bloqueur (tldts, via
  `Request` de `@ghostery/adblocker`), pas de seconde copie.

**Données des sites** (Paramètres, section « Données des sites ») : sites ayant des cookies dans la
session par défaut et les partitions des espaces isolés, groupés par domaine enregistrable, avec
recherche, effacement par site (mêmes règles que ci-dessus, dans chaque session) et « Tout effacer »
(`clearStorageData()` de chaque session ; historique et favoris conservés), avec confirmation.
Indisponible en fenêtre privée (IPC refusée : `null`), qui ne gère pas les données du profil.

**Bloquer les cookies tiers** (`privacy.blockThirdPartyCookies`, **désactivé** par défaut ; exceptions
par site `privacy.thirdPartyCookieExceptions`, validées et bornées à 500). Electron n'a pas de réglage de
session : les requêtes des onglets vers un autre site que celui de la page (domaines enregistrables
différents ; jamais le document principal) perdent leur en-tête `Cookie` (`onBeforeSendHeaders`) et
leurs `Set-Cookie` (`onHeadersReceived`). `webRequest` n'acceptant qu'un écouteur par événement et par
session, c'est fait dans les écouteurs du pipeline de confidentialité (`src/main/privacy/index.ts`).
Limites (raison du « désactivé par défaut » et de la réserve d'ADR-008) : `document.cookie` d'une
iframe tierce reste lisible et modifiable (rien n'est injecté dans les pages), et des connexions
unifiées (SSO) ou contenus intégrés peuvent casser : l'exception s'ajoute depuis les infos du site.

**Bouton « Copier le lien »** dans la barre d'adresse et dans le popover : commande `copy-url`,
confirmation « Lien copié » (coche animée, annonce `role="status"`).

**Commandes** : « Infos sur le site » et « Effacer les données du site » (confirmation dans la palette)
rejoignent le registre ; la première est aussi dans le menu Affichage et sur mobile.

**Mobile.** « Copier le lien » dans l'appui long sur la barre d'adresse (était « Copier l'adresse »), le
menu de la page et l'appui long sur un lien (avec « Ouvrir dans un nouvel onglet », déjà là). Toucher
le cadenas ouvre une feuille : hôte, HTTPS ou non, copier le lien, « Effacer les données du site ».
react-native-webview n'a pas d'API de cookies par site et `@react-native-cookies/cookies` (natif)
n'est pas dans Expo Go : l'effacement passe par un script injecté dans la page, qui vide ce que la page
atteint elle-même (localStorage, sessionStorage, IndexedDB, Cache Storage, cookies visibles des
scripts) puis la recharge. Les cookies `HttpOnly` restent ; la feuille le dit.

## ADR-022 — Organisation : dossiers, grille des favoris, gestes entre espaces, archivage

**Contexte.** Le propriétaire veut un navigateur « utile et très pratique » : ranger ses onglets,
garder ses sites de tous les jours à portée, passer d'un espace à l'autre au trackpad, et ne plus
accumuler des dizaines d'onglets oubliés. Sur le bureau comme sur le téléphone.

**Dossiers (bureau).** Modèle pur `src/shared/folders.ts` (testé) : dossiers imbriqués (4 niveaux,
64 au plus), par espace, avec nom, icône Lucide de `SPACE_ICONS` (`folder` par défaut), état replié.
Un onglet pointe vers son dossier (`TabState.folderId`) ; un onglet épinglé n'est jamais rangé.
- Règle d'affichage (comme Arc) : dans chaque conteneur, les sous-dossiers d'abord, puis les onglets.
  `TabManager` garde sa liste plate triée dans cet ordre (`visualOrder`) : Ctrl+Tab suit l'écran,
  et le reste du code (veille, scindé, palette) ne change pas.
- Un dossier replié cache son contenu, sauf l'onglet actif. Un lien ouvert depuis un onglet rangé
  reste dans le même dossier ; un onglet déplacé vers un autre espace arrive hors dossier.
- Glisser-déposer au pointeur (`pointerdown/move/up`, seuil de 5 px, Échap annule) : onglets et
  dossiers se réordonnent, entrent dans un dossier ou en sortent ; `dropZone`/`resolveDrop` (purs)
  calculent la cible et l'indicateur (ligne d'insertion décalée au niveau d'arrivée, ou dossier
  surligné), si bien que l'indicateur montre toujours où l'élément atterrira vraiment. Alternatives
  au clavier dans le menu contextuel d'onglet : « Déplacer vers le dossier… » et « Nouveau dossier
  avec cet onglet » ; commande « Nouveau dossier » dans le registre.
- Popover du dossier (dans la barre latérale) : renommer, icône, sous-dossier, supprimer. Supprimer
  un dossier non vide demande s'il faut aussi fermer ses onglets (sinon ils remontent d'un niveau).
- **Persistance** : `session.json` passe en **version 3** : chaque liste d'onglets d'un espace gagne
  `folders`, ses onglets `folderId` et `lastSeenAt` (pour l'archivage). Une session v2 se lit comme
  une v3 sans dossiers (même forme, champs facultatifs) ; un dossier inconnu renvoie l'onglet à la
  racine, les cycles et l'imbrication trop profonde sont réparés (tests de `session.test.ts`).
  Les fenêtres privées ont des dossiers en mémoire, jamais écrits.

**Grille des favoris.** Des tuiles de sites en haut de la barre latérale, communes à tous les
espaces, distinctes des onglets épinglés (par espace) et des favoris/marque-pages (longue liste
classée, ADR-005). Réutiliser le magasin des favoris avec un drapeau de dossier « Favoris » n'était
pas propre : un favori n'y appartient qu'à un seul dossier (l'ajouter à la grille l'aurait sorti de
son dossier), la grille a besoin d'un ordre, et le téléphone ignore les dossiers de favoris. D'où un
petit magasin à part, `favorites.json` (modèle pur `src/shared/favorites.ts`, 24 tuiles au plus,
http(s) seulement), synchronisé comme **collection supplémentaire `favorites`** du moteur de l'ADR-019
(identifiant `fav:<url>` haché, position dans la grille ; les favicons restent sur l'appareil).
- Une tuile ouvre l'onglet de son site (même page d'abord, sinon le plus récent sur le même hôte,
  dans l'espace affiché puis les autres espaces de la fenêtre), sinon un nouvel onglet ; un point
  signale un onglet ouvert. Clic droit : ouvrir, ouvrir dans un nouvel onglet, retirer.
- Ajout/retrait : menu contextuel d'onglet, glisser un onglet sur la grille, commande « Ajouter aux
  favoris (tous les espaces) » : la mention « tous les espaces » dit que la grille est commune, et la
  distingue de l'étoile (Ctrl+D). Grille vide : une zone de dépôt discrète (« Glissez un onglet ici
  pour l'épingler dans tous les espaces ») la fait découvrir ; masquée pour de bon par sa croix
  (préférence locale `layout.favoritesHintDismissed`), elle ne revient alors que pendant un glisser,
  flottant au-dessus de la liste.
- Fenêtres privées : la grille est lisible et cliquable, jamais modifiable (refusé dans main).

**Changer d'espace au geste.** Module pur `src/shared/space-swipe.ts` (testé sur des séquences
réalistes) alimenté par les événements `wheel` de toute la barre latérale, en phase de capture (un
geste commencé sur la liste d'onglets ou un autre enfant défilant est vu en premier) : les pavés
tactiles de macOS et les pavés de précision de Windows livrent le défilement à deux doigts comme des
`wheel` en pixels, l'horizontal dans `deltaX`.
- Verrou d'axe sur les 4 premiers pixels : horizontal si `|x| > 1,2 × |y|`, sinon le geste reste un
  défilement jusqu'à sa fin ; une molette de souris (seulement `deltaY`, ou en lignes) ne déclenche
  jamais rien, ni Maj+molette ni Ctrl+molette (zoom).
- Suivi 1:1 : la zone des onglets est une piste horizontale où l'espace affiché a ses voisins à côté
  (`BrowserState.peeks` : onglets et dossiers des espaces précédent et suivant, 40 onglets au plus,
  dessinés inertes). Effet élastique au premier et au dernier espace ; l'indicateur des pastilles
  d'espace glisse avec les doigts.
- Décision au relâchement : fin du geste après 140 ms sans événement, ou dès que les deltas
  décroissent (doigts levés : inertie de macOS, de Windows). Bascule au-delà de 25 % de la largeur ou
  sur un geste vif (≥ 0,5 px/ms sur les 80 dernières ms, après 16 px). La piste glisse alors jusqu'à
  la position calée (220 ms, ease-out) et seulement ensuite l'espace change, sans l'animation
  d'entrée propre au changement (le voisin est déjà à sa place : ni saut ni flash). Clavier et clic
  gardent une seule glissade. « Réduire les animations » garde le geste sans suivi ni glissade.
- **Un geste, un espace** : après une bascule, la fin de la rafale (inertie) est avalée jusqu'à une
  pause de 140 ms, sauf si un nouveau geste y commence nettement (deltas qui repartent à la hausse,
  ou sens inverse) : un second balayage rapide n'est pas perdu.
- **Sur la page**, rien n'est intercepté : l'écouteur vit dans l'interface, les pages n'ont ni
  preload ni écouteur ajouté. Par défaut, Electron n'ajoute pas la navigation précédent/suivant par
  balayage à deux doigts de Chrome (fonction de la couche `chrome/` ; l'API d'Electron 44 n'expose
  que l'événement `swipe` à trois doigts de macOS et `isSwipeTrackingFromScrollEventsEnabled`) ; la page
  reçoit ses événements `wheel` comme avant (défilement horizontal du site). Ce comportement par
  défaut est conservé, pas imité.
- macOS : le balayage à trois doigts (événement `swipe` de `BrowserWindow`, « left »/« right »,
  quand « Balayer entre les pages » l'autorise) change aussi d'espace.
- Tests e2e : des `WheelEvent` synthétiques avec `deltaX` sur la barre latérale changent l'espace
  exactement une fois ; une molette verticale ne change rien ; rien au-delà du premier espace ; une
  longue traîne d'inertie ne change d'espace qu'une fois.

**Archivage automatique.** Réglage « Archiver les onglets inactifs après » : Jamais, 12 h, 24 h,
7 jours (défaut), 30 jours (`behavior.archiveTabsAfter`, non synchronisé). Politique pure partagée
`src/shared/archive.ts` (testée) : jamais l'onglet affiché, épinglé, d'un site de la grille des
favoris, qui joue du son, d'une vue scindée, ni la page d'accueil ou une page interne ; un onglet
sans date connue est gardé. Le bureau la nourrit avec les candidats de la mise en veille
(`TabManager.sleepCandidates`, qui gagnent `url` et `inSplit`) et compte l'inactivité depuis
`lastSeenAt`, désormais enregistré dans la session (un redémarrage ne remet pas les compteurs à zéro).
Contrôle toutes les 10 minutes (`BROWSER_TEST_ARCHIVE_MS` pour les tests, ignoré une fois empaqueté).
- Un onglet archivé est fermé et rangé dans `archive.json` (500 au plus, le plus récent par URL) :
  page interne `browser://archive` (recherche, restaurer, supprimer, tout supprimer ; ADR-012) et
  section « Onglets archivés » de la palette Ctrl+K. Restaurer rouvre la page dans son espace s'il
  existe encore dans la fenêtre. Les fenêtres privées ne sont jamais archivées ; elles lisent la
  liste et peuvent rouvrir une page sans la modifier.

**Mobile.**
- Vue des onglets : un balayage horizontal sur la grille passe à l'espace précédent/suivant (pages
  dans l'ordre des pastilles : Privé, puis les espaces), la grille suit le doigt avec un effet
  élastique aux extrémités, les pastilles défilent vers l'espace affiché. Le balayage horizontal
  appartenant désormais au pager, une carte se ferme par sa croix, son menu ou l'action
  d'accessibilité (comme dans la vue des onglets de Firefox iOS), plus par balayage latéral.
- Dossiers, version simple : un niveau, par espace ; les cartes sont regroupées sous un en-tête
  repliable (toucher : replier ; maintenir : renommer, supprimer en gardant ou en fermant les
  onglets). Rangement depuis le menu d'une carte, « Déplacer vers un dossier » (dont « Nouveau
  dossier » et « Hors dossier »). La géométrie (en-têtes sur leur propre ligne) reste calculée, pas
  mesurée, pour la transition de zoom (`sectionedGrid`). Session AsyncStorage en version 2.
- Grille des favoris : rangée sur la page d'accueil et en tête de la vue des onglets, même magasin
  synchronisé (`browser.favorites`) ; ajout/retrait depuis le menu d'une carte, jamais pour un
  onglet privé.
- Archivage : même réglage et même politique (au démarrage, chaque minute et au retour au premier
  plan) ; section « Archivés » dans la vue des onglets (toucher : restaurer ; corbeille : supprimer).

**Limites.** Pas de glisser-déposer pour réordonner les tuiles (l'API `favorites.move` existe) ; sur
le téléphone, ni imbrication ni
glisser-déposer des cartes ; le geste à deux doigts n'a été vérifié qu'avec des événements
synthétiques (xvfb), pas avec un vrai pavé tactile ; l'archivage mobile ne sait pas si une page joue
du son.

## ADR-023 — Releases GitHub et site vitrine

**Contexte.** Le propriétaire veut pouvoir installer Browser sur ordinateur depuis une release
(Windows d'abord) ou depuis un site vitrine dans le style du navigateur. ADR-015 ne produisait que des
dossiers non compressés en artefacts de CI.

**Release** (`.github/workflows/release.yml`), déclenchée par un tag `v*` ou à la main
(`workflow_dispatch`, champ `version`) :
- `prepare` (Ubuntu) valide la version (semver, suffixe = *pre-release*), lance typecheck et tests.
  La version du tag (ou saisie) est appliquée à `package.json` dans chaque job de build
  (`npm pkg set version`, sans commit) : un tag qui ne correspond pas à `package.json` donne un
  avertissement, pas un échec.
- `build` : matrice Windows / macOS / Ubuntu, `electron-builder --win|--mac|--linux --publish never`.
  Cibles et architectures dans la clé `build` de `package.json` : NSIS + `zip` (x64, arm64), `dmg`
  (arm64, x64, deux fichiers plutôt qu'un universel deux fois plus lourd), AppImage + `deb` (x64).
  Noms stables via `artifactName` (`Browser-Setup-<v>-<arch>.exe`, `Browser-<v>-<os>-<arch>.<ext>`),
  dont dépend la détection du site.
- `publish` : rassemble les artefacts, calcule `SHA256SUMS.txt`, crée la release avec
  `softprops/action-gh-release` (notes générées automatiquement + tableau d'installation). Seul ce job
  a `contents: write`. `"publish": null` reste en place : pas de `latest.yml` ni d'auto-update.
- Actions épinglées par SHA de commit (version en commentaire).
- **Signature facultative** : `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` (Windows) et
  `CSC_LINK`/`CSC_KEY_PASSWORD` (macOS) ne sont exportés que s'ils existent. Sinon
  `CSC_IDENTITY_AUTO_DISCOVERY=false`, et sur macOS signature *ad hoc* (`mac.identity = "-"`,
  `hardenedRuntime` coupé) : une app arm64 sans aucune signature est déclarée « endommagée » par
  Gatekeeper, une app ad hoc demande seulement clic droit → Ouvrir. Pas de notarisation.
- Procédure : `npm run release:version -- <version>` (`npm version` : commit + tag) puis
  `git push --follow-tags`.

**Installateur Windows (NSIS assisté).** `oneClick: false`, `perMachine: false` : page « pour moi
seul » (par défaut, sans élévation, `%LOCALAPPDATA%\Programs`) ou « pour tous » (élévation UAC),
choix du dossier, raccourci menu Démarrer, désinstallateur avec nom/éditeur/icône (`author`,
`build/icon.ico`), profil conservé à la désinstallation, interface en français (`fr_FR`).
electron-builder n'offre pas de case pour le raccourci Bureau : `build/installer.nsh`
(`nsis.include`, UTF-8 avec BOM) remplace la page de fin (même lancement de l'app que la page par
défaut) et ajoute « Créer un raccourci sur le Bureau », cochée ; décochée, le raccourci créé par
l'installation est supprimé en quittant la page. Installations silencieuses et mises à jour : le
raccourci reste. La fonction de sortie est définie *après* `MUI_PAGE_FINISH`, qui déclare
`$mui.FinishPage.ShowReadme` (sinon avertissement 6000, fatal avec `-WX`).
- Vérifié sous Linux : le paquet Windows et le script NSIS complet (avec l'include) compilent avec le
  `makensis` d'electron-builder ; l'exécution de l'installateur (et l'édition des ressources de l'exe,
  qui demande wine) n'a pas été testée ici : c'est le runner Windows qui fait foi.

**Site vitrine** (`site/`, `.github/workflows/site.yml`) :
- Vite + TypeScript sans framework (une page, ~5 Ko de JS, ~15 Ko de CSS ; < 0,5 Mo au total avec
  les captures en WebP). Svelte n'apporterait rien à une page statique. Icônes Lucide
  (`lucide-static`) insérées en SVG au build par un petit plugin Vite (`<i data-icon="…">`) : aucun
  runtime ; un nom inconnu fait échouer le build. Aucun emoji (ADR-017).
- Langage visuel de l'app : dégradés en maillage `--accent`/`--accent-2`, « aurore » animée de la page
  d'accueil (désactivée avec `prefers-reduced-motion`), surfaces vitrées, grands rayons, police
  Inter/système. Sombre par défaut, thème clair au choix (mémorisé dans `localStorage`, appliqué
  avant le premier rendu).
- Téléchargement : détection du système (User-Agent Client Hints, architecture ARM sur Windows ;
  Apple Silicon par défaut sur Mac), puis `GET https://api.github.com/repos/Mathieu-Lalande/browser/releases/latest`
  côté client ; chaque lien vise l'asset correspondant. Sans release (404), limite de débit (403) ou
  réseau coupé, tous les liens restent sur la page des releases (liens présents dans le HTML : le
  site fonctionne sans JavaScript). Sur téléphone, le bouton mène à la liste des plateformes.
- `base: "/browser/"` (Pages de projet) ; déploiement par `actions/deploy-pages` à chaque push sur
  `master` touchant `site/`. Prérequis manuel : *Settings → Pages → Source : GitHub Actions*.
  Adresse : https://mathieu-lalande.github.io/browser/. Captures : `docs/screenshots/site-*.png` ;
  image OpenGraph `site/public/og.png` (1200×630, capture du haut de page).

**Limites.** Ni signature ni notarisation par défaut (SmartScreen et Gatekeeper avertissent, expliqué
dans la FAQ du site et les notes de release) ; pas de mises à jour automatiques ; pas de Linux arm64 ;
le workflow n'a pas pu être exécuté hors de GitHub (YAML validé, entrées des actions vérifiées sur
leurs `action.yml`). La CI de `master` (`npm run dist:dir`) construit désormais aussi les dossiers
arm64 sous Windows et macOS (cibles communes).

## ADR-024 — Extensions du navigateur (bureau)

**Contexte.** ADR-001 promettait un support partiel des extensions Chrome. Electron 44 fournit
`session.extensions` (`loadExtension`, `removeExtension`) : extensions non empaquetées seulement,
pas de sessions en mémoire, une partie des API `chrome.*` (scripts de contenu, `runtime`, `storage`,
`tabs` partiel, `scripting`…), pas d'interface (ni boutons d'action ni popups).

**Décision.**
- Installation depuis `browser://extensions` (commande « Extensions », lien dans Paramètres →
  Comportement) : **dossier non empaqueté** (utilisé sur place, jamais copié ni supprimé) ou fichier
  **.zip / .crx** décompressé dans `<profil>/extensions/<id>/`. CRX2/CRX3 : l'en-tête est retiré
  (signature non vérifiée : c'est l'utilisateur qui choisit le fichier, comme « charger l'extension
  non empaquetée » de Chrome). Lecteur ZIP maison (`src/main/extensions/unpack.ts`, sans dépendance) :
  entrées stockées/deflate, ni ZIP64 ni chiffrement, CRC vérifié, tailles bornées, chemins contrôlés
  (aucune écriture hors du dossier cible), dossier racine unique déballé.
- Le manifeste est validé avant tout (`validateManifest`, `src/shared/extensions.ts`) : Manifest V2
  ou V3, nom (y compris `__MSG_…__` de la langue par défaut), version au format Chrome ; sinon une
  erreur en français. Chromium peut encore refuser l'extension au chargement : rien n'est alors gardé.
- Liste dans `extensions.json` (id à la Chrome tiré au hasard, chemin, activée, autorisée en privé,
  nom, version, description, icône en `data:` ≤ 64 Ko). L'interface ne voit jamais les chemins ; les
  dossiers et fichiers sont choisis dans les boîtes de dialogue de main. Une fenêtre privée liste les
  extensions mais ne peut pas les modifier (ADR-014).
- Chargement : `installExtensions(session)` (`src/main/extensions/`), idempotente comme
  `installDownloads`, appelée par `hardenSession` pour chaque session d'onglets (session par défaut,
  partitions des espaces isolés, fenêtres privées). Activer/désactiver/retirer s'applique à toutes
  les sessions connues ; la page doit être rechargée.
- **L'interface quitte la session par défaut** : chrome et overlay vivent dans `browser-ui`
  (`src/main/ui-session.ts`, en mémoire, protocole `app://` servi là, seule permission : écrire dans
  le presse-papiers). Chromium y *liste* les extensions de la session par défaut (c'en est le côté
  « incognito ») mais ne les y exécute jamais ; le test e2e le vérifie sur une URL web.
- Fenêtres privées : seulement les extensions marquées « Autoriser en navigation privée » (désactivé
  par défaut). Electron refusant de charger une extension dans une session en mémoire, l'option est
  enregistrée mais sans effet pour l'instant (dit sur la page) : aucune extension ne s'exécute en privé.

**Mobile.** Les WebView iOS/Android n'ont pas d'extensions : rien côté `mobile/`.

**Suites possibles.** Boutons d'action et popups (`action`/`browser_action`) dans la barre latérale,
via le calque overlay ; mise à jour d'une extension installée (aujourd'hui : la retirer puis la
réinstaller, un nom déjà installé est refusé) ; installation depuis le Chrome Web Store ; extensions
en navigation privée si Electron l'autorise un jour.

## ADR-025 — Gestionnaire de mots de passe

**Contexte.** Enregistrer et remplir les mots de passe, sur le bureau et le téléphone, sans revenir sur
ADR-003 : les onglets n'ont ni preload ni canal IPC, et un mot de passe ne doit pas traîner dans
l'interface ni dans le monde JavaScript des pages.

**Modèle** (`src/shared/passwords.ts`, pur et testé, partagé avec le mobile) : entrée `id`, `origin`,
`username`, `password`, `createdAt`, `updatedAt`, `lastUsedAt` ; un compte = origine + identifiant (une
nouvelle soumission met son mot de passe à jour) ; liste « Jamais pour ce site » ; recherche ; export CSV
aux colonnes de Chrome/Firefox (`name,url,username,password`, toutes les cellules entre guillemets, valeurs
jamais modifiées).

**Correspondance : origine exacte** (schéma + hôte + port). Pas de regroupement par domaine
enregistrable (eTLD+1) : il donnerait le mot de passe de `example.com` à tout sous-domaine (pages
d'utilisateurs, hébergement partagé, sous-domaine compromis) et celui d'un site https à sa version http.
Coût : un site qui connecte sur plusieurs hôtes demande un second enregistrement.

**Capture sans preload (bureau).** À chaque `dom-ready` (crochet `pageReady` de `TabManager`), main
exécute un script dans un **monde isolé** (`executeJavaScriptInIsolatedWorld`, monde 1004, comme le scan
cosmétique d'ADR-006) : il partage le DOM mais aucun JavaScript avec la page. Il pose des écouteurs en
phase de capture (envoi de formulaire, clic sur un bouton d'envoi, Entrée dans un champ mot de passe ;
événements `isTrusted` seulement : un script ne peut pas simuler une connexion) et **renvoie une
promesse** résolue à la connexion suivante avec `{ origin, username, password }`, ou `null` quand la page
s'en va (`pagehide`). Le résultat revient à main comme valeur de retour de l'exécution — aucun canal
ouvert, rien d'exposé à la page — puis main relance l'attente (un jeton par page arrête les boucles d'un
document remplacé). L'origine est `location.origin` lu dans le monde isolé, que la page ne peut pas
falsifier ; la capture est revalidée (`sanitizeCapture`). Polling et instantané à `did-navigate` ont été
écartés : trop tard (la page est partie) ou trop tôt (champs vides).

- **Invite** : popover du calque overlay (ADR-010, `OverlayKind` « password-save ») pour l'onglet à
  l'écran : « Enregistrer le mot de passe pour <site> ? » (ou « Mettre à jour… ») — Enregistrer, Jamais
  pour ce site, Plus tard. Main garde la capture sous un identifiant aléatoire (10 min au plus) ;
  l'overlay ne reçoit que le site et l'identifiant. Pas d'invite pour un compte déjà enregistré tel quel,
  un site de la liste « Jamais », ni deux fois pour la même connexion (clic puis envoi).
- **Fenêtres privées : jamais d'invite** — `tabHooksFor` ne transmet pas `pageReady` (testé) et
  `onCapture` vérifie `isPrivate`. Le remplissage y reste possible (lecture, comme l'historique) mais
  n'écrit pas « dernière utilisation ».
- **Remplissage** : uniquement sur demande — clé de la barre d'adresse (affichée si `TabState.hasPasswords`)
  qui ouvre le popover « password-fill » (identifiants seulement), ou « Remplir le mot de passe » du menu
  contextuel d'un champ (direct s'il n'y a qu'un compte). Main vérifie que l'entrée a l'origine de la page,
  puis un script en monde isolé (1005) vérifie encore `location.origin` et pose les valeurs comme une
  saisie (setter natif, événements `input`/`change`) : c'est à ce moment seulement que la page voit le mot
  de passe. Cadre principal seulement (pas d'iframes).
- **Stockage** : `passwords.json` = un bloc chiffré par `safeStorage` (Trousseau, DPAPI,
  libsecret/kwallet), coffre déchiffré seulement dans main. Chiffrement indisponible (Linux sans trousseau,
  où Electron le déclare indisponible) : **rien n'est enregistré**, message en français (invite muette,
  bandeau sur la page). Fichier indéchiffrable (trousseau changé ou verrouillé) : gardé tel quel, jamais
  réécrit. Si le magasin « basic » de Chromium est en usage, la page le signale comme protection faible.
  Crochet de test `BROWSER_TEST_PLAIN_KEYCHAIN=1` (clé « basic » en mémoire, ignoré une fois empaqueté).
- **Interface** (`browser://passwords`, commande « Mots de passe », lien dans Paramètres → Confidentialité) :
  recherche, afficher (après confirmation dans l'interface : seul `passwords:reveal` fait traverser un mot
  de passe par l'IPC), copier (fait par main, presse-papiers vidé après 30 s s'il n'a pas changé),
  modifier, supprimer, liste « Jamais », export CSV en clair après confirmation (boîte d'enregistrement de
  main, fichier 0600).

**Mobile** (`mobile/src/lib/passwords.ts`, testé avec Jest). Coffre dans `expo-secure-store` (Keychain
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Keystore ; disponible dans Expo Go), en morceaux de 1 800 caractères
(certaines versions d'iOS refusent les grandes valeurs). Les WebView n'ont pas de monde isolé exploitable :
le script de capture (onglets normaux seulement) poste un message par le pont existant, que **toute page
peut imiter** ; il est donc traité comme une entrée non fiable : forme et tailles validées, **origine prise
de l'URL de l'onglet**, jamais du message, onglet à l'écran seulement, une invite toutes les 3 s au plus,
et l'invite (feuille d'actions) ne fait qu'enregistrer ce que la page possède déjà. Remplissage par
`injectJavaScript` au toucher d'un compte (bouton clé dans la barre, menu de la page), après vérification
de l'origine côté app puis dans le script. Section « Mots de passe » des paramètres : recherche, afficher
(confirmation), copier (presse-papiers vidé après 30 s), supprimer, liste « Jamais ».

**Synchronisation : non incluse (suite possible).** Le moteur d'ADR-019 chiffrerait les mots de passe de
bout en bout, mais son état local (`sync.json`, AsyncStorage) garde un *miroir* haché de chaque
enregistrement synchronisé, hors du trousseau, et il faudrait une collection de plus côté serveur, bureau
et mobile. À faire avec un miroir lui-même chiffré (ou des hachés à clé) et un réglage explicite.

**Limites.** Pas de détection des connexions réussies (une invite peut suivre un mauvais mot de passe :
« Plus tard ») ni des formulaires en plusieurs étapes (identifiant puis mot de passe sur deux pages) ;
pas de génération de mot de passe ; pas d'import CSV ; pas de verrouillage par le mot de passe du système
avant « Afficher » (confirmation dans l'interface seulement).
