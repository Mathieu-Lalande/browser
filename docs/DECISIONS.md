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
- Sécurité : `src/main/window.ts` tient un registre (`WindowRegistry`, `src/main/window-registry.ts`)
  `webContents.id → BrowserController` des interfaces
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

- `installDownloads(session)` (renommé : `DownloadService.install`, `src/main/downloads/service.ts`, un
  `SessionService` de `AppServices`) branche `will-download` sur une session ; idempotente, elle est appelée
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
  `installDownloads(ses, { ephemeral })` (renommé : `DownloadService.install(ses, { ephemeral })`) : le fichier est enregistré où l'utilisateur l'a demandé, l'entrée
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
- Mises à jour automatiques : ADR-030 (`"publish"` pointe désormais vers les releases GitHub ; les
  commandes gardent `--publish never`, electron-builder écrit seulement les `latest*.yml`).

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
  « Ignorer » ; effacée à la navigation suivante. Une fenêtre permise n'est plus rouverte à neuf
  (`deny` + nouvel onglet, qui perdait `window.opener` et cassait les connexions SSO type Okta) :
  `setWindowOpenHandler` répond `allow` + `createWindow`, et `TabManager.adoptPopup` enveloppe la page
  créée par Chromium dans un onglet placé après l'ouvreur (même session, donc même fenêtre privée ;
  préférences `TAB_WEB_PREFERENCES` imposées par `overrideBrowserWindowOptions`, jamais de fenêtre
  native). `opener.postMessage`, cible nommée et `about:blank` puis navigation fonctionnent ; l'onglet
  affiche « Chargement… » sur fond blanc jusqu'au premier document ; `window.close()` le ferme et
  réactive l'ouvreur. L'aperçu Maj+clic (ADR-027) et la bande « Ouvrir » gardent le nouvel onglet.
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

- Bureau : `src/main/sync/` (`SyncService` de `AppServices`, `service.ts` ; renommé depuis `startSync`/`syncController`
  de `index.ts`), adaptateurs du profil, `net.fetch` d'Electron pour le proxy et les
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
  a `contents: write`. Depuis ADR-030, la release publie aussi `latest*.yml` et les `.blockmap`.
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
- Chargement : `installExtensions(session)` (renommé : `ExtensionService.install`,
  `src/main/extensions/service.ts`), idempotente comme `DownloadService.install`, appelée par `hardenSession`
  (via `SessionHardener`) pour chaque session d'onglets (session par défaut,
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
- **Contrôles côté main (post-audit).** L'export demande en plus sa propre confirmation native
  (`dialog.showMessageBox` de la fenêtre) : l'interface seule ne peut pas exporter. « Afficher » et « Copier »
  sont limités à `PASSWORD_ACCESS_LIMIT` (10) par minute et par fenêtre (`takePasswordAccess`, fenêtre
  glissante) ; au-delà, refus avec un message français affiché sur la page. Dans le CSV, nom, URL et
  identifiant commençant par `= + - @`, tabulation ou retour chariot reçoivent un `'` (injection de formules
  dans un tableur) ; le mot de passe reste tel quel (il doit se réimporter à l'identique).

**Mobile** (`mobile/src/lib/passwords.ts`, testé avec Jest). Coffre dans `expo-secure-store` (Keychain
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Keystore ; disponible dans Expo Go), en morceaux de 1 800 caractères
(certaines versions d'iOS refusent les grandes valeurs). Les WebView n'ont pas de monde isolé exploitable :
le script de capture (onglets normaux seulement) poste un message par le pont existant, que **toute page
peut imiter** ; il est donc traité comme une entrée non fiable : forme et tailles validées, **origine prise
de l'URL de l'onglet**, jamais du message, onglet à l'écran seulement, une invite toutes les 3 s au plus,
et l'invite (feuille d'actions) ne fait qu'enregistrer ce que la page possède déjà. Un cadre (même d'une
autre origine) peut poster sur ce pont : le script de capture n'est donc plus dans `injectedJavaScript`, mais
injecté par l'app à chaque fin de chargement du cadre principal avec un **nonce aléatoire** (128 bits,
`expo-crypto`) gardé dans sa fermeture ; `PasswordCaptureGuard` exige ce nonce sur chaque message, ignore tout
message entre le début et la fin d'un chargement, et ceux dont l'URL (`nativeEvent.url`) ou celle de l'onglet
n'est pas sur l'origine pour laquelle le script a été injecté. Remplissage par
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


## ADR-026 — Mode lecture et version mobile/ordinateur des sites

**Contexte.** Lire un article sans le reste de la page, sur le bureau et le téléphone, sans revenir sur
ADR-003 (pas de preload ni d'IPC pour les pages) ni sur la CSP de l'interface (`img-src 'self' data:`,
ADR-018) ; et pouvoir demander la version mobile (bureau) ou ordinateur (téléphone) d'un site.

**Extraction.** `@mozilla/readability` (Mozilla, celle de Firefox), en dépendance de développement :
son source est recopié tel quel dans `src/shared/readability-source.ts` par `scripts/gen-readability.mjs`
(module généré, commun à Vite et Metro ; un test vérifie qu'il correspond au paquet installé). Le script
de page (`READER_EXTRACT_SCRIPT`, `src/shared/reader.ts`) fait tourner Readability sur un **clone** du
document (la page n'est pas modifiée ; un document sans contexte de navigation ne charge rien) et renvoie
un **arbre JSON** (balise, enfants, `href`/`src`/`alt` absolus), jamais du HTML.

- **Bureau** : monde isolé 1006 (`src/main/reader/`), comme ADR-025 : la page ne voit ni ne modifie
  Readability. `isProbablyReaderable` tourne à chaque fin de chargement (`TabState.readerable`, y compris
  en fenêtre privée : lecture seule) et affiche le bouton livre de la barre d'adresse ; commande
  « Mode lecture » (`toggle-reader`, Ctrl+Alt+R / ⌥⌘R, menu Affichage, palette).
- **Téléphone** : pas de monde isolé exploitable ; `injectJavaScript` à la demande (menu de la page), la
  réponse revient par le pont existant, que toute page peut imiter : elle doit porter le jeton de la
  demande en cours, est bornée en taille et l'URL est celle de l'onglet (`mobile/src/lib/reader.ts`).

**Assainissement : liste blanche, pas d'HTML.** `sanitizeReaderArticle` (pur, testé, partagé) garde une
liste fixe de balises (paragraphes, titres, listes, citations, code, tableaux, liens, images…), en renomme
quelques-unes (`h1`→`h2`, `b`→`strong`…), déballe les inconnues, supprime avec leur contenu `script`,
`style`, `iframe`, `svg`, formulaires, médias… ; aucun attribut hormis `href` (http(s) seulement, via
`isPageOpenableUrl`) et `src`/`alt` des images (http(s)) ; bornes : 20 000 nœuds, profondeur 32,
400 000 caractères, 40 images. Les interfaces dessinent l'arbre avec leurs propres éléments
(`<svelte:element>` sur la liste fixe ; `Text` React Native) : aucun HTML n'est analysé ni injecté, donc
pas de DOMPurify (et pas de DOM côté main ni sur le téléphone pour le faire tourner).

**Rendu bureau.** L'interface dessine la vue lecture (`ReaderView.svelte`) à la place de la vue de la page,
détachée comme pour une page interne (`TabManager.setReader`) ; jamais par l'origine de la page. Hors vue
scindée seulement. Une navigation de la page quitte le mode lecture. Les liens naviguent l'onglet (Ctrl/clic
milieu : nouvel onglet). **Images** : main récupère les 12 premières comme les favicons (session de
l'onglet, boucliers, HTTPS-Only, `Sec-GPC`, image matricielle, 2 Mo et 5 s chacune) et les passe en
`data:` ; les autres sont retirées. Choix : la CSP reste inchangée et aucune requête ne part hors de la
session de l'onglet (fenêtre privée comprise).

**Rendu téléphone.** Écran natif (`ReaderScreen`, `readerBlocks` pur et testé), sans WebView. Les images
sont **remplacées par leur description** : un `Image` React Native les chargerait hors de la session (cookies,
boucliers) de la WebView de l'onglet.

**Préférences** (`settings.reader`, validées par `sanitizeSettings`, partagées avec le téléphone, non
synchronisées) : police serif / sans serif, taille 14–28 px, largeur des lignes (bureau), thème « Thème »
(suit l'application), « Sépia », « Sombre » (`readerColors`). Temps de lecture estimé à 230 mots/min.

**Version mobile / ordinateur.** Bureau : « Demander la version mobile » (`toggle-mobile-site`, par onglet,
non enregistré) remplace le user agent de la page par celui de Chrome Android (`mobileUserAgent`, même
version réduite) puis recharge ; réappliqué si la vue est recréée (veille). Les indices client
(`Sec-CH-UA-Mobile`) restent ceux du bureau : outil de test, pas d'émulation (ni viewport ni tactile).
Téléphone : « Version ordinateur » (menu de la page, par onglet, durée de l'exécution) change le
`userAgent` de la WebView (Safari macOS sur iOS, Chrome Linux sur Android) puis recharge.

**Limites.** Readability peut se tromper (pages non-articles, contenu chargé tard) ; pas de mode lecture
dans les iframes ni en vue scindée ; images absentes sur le téléphone ; le jeton mobile n'est pas secret
pour la page (elle voit le script) : il ne fait que relier une réponse à la demande, la page ne pouvant de
toute façon montrer que son propre contenu.

## ADR-027 — Aperçu des liens (« link peek »)

**Contexte.** Comme Arc : regarder un lien sans quitter la page, dans une carte flottante, puis le garder
(onglet, vue scindée) ou le fermer. Sur le bureau, l'interface ne peut pas dessiner au-dessus des pages
(ADR-010) et les pages n'ont ni preload ni IPC (ADR-003).

**Bureau** (`src/main/peek.ts`, géométrie pure `src/shared/peek.ts`, carte `src/renderer/src/overlay/LinkPeekPanel.svelte`).
- La page prévisualisée est une `WebContentsView` à part, durcie comme un onglet (sandbox, sans preload,
  `hardenWebContents` : bloqueur de fenêtres, schémas web seulement ; `attachTabPrivacy` : boucliers,
  HTTPS-Only, GPC) dans la **session de l'onglet source** (fenêtre privée : sa session privée ; espace isolé :
  sa partition). Pas de barre d'autorisation dans la carte : toute demande de permission y est refusée.
- Empilement : le calque overlay s'ouvre (`OverlayKind` « link-peek », voile assombri sans capture floutée)
  et dessine la carte (≈ 80 % de la zone des pages, centrée, coins arrondis, ombre) avec son en-tête
  (titre, adresse, « Ouvrir dans un onglet », « Ouvrir en vue scindée », « Fermer ») ; la vue de la page est
  posée **au-dessus** de l'overlay, dans la carte sous l'en-tête (`Overlay.setTopView` garde cet ordre quand
  l'overlay se remonte). L'overlay ne nomme qu'une action (IPC `peek:action`, validée) : main garde l'URL.
- Déclencheurs : entrée « Aperçu du lien » du menu contextuel (ADR-021) et Maj+clic. Electron 44 ne donne
  pas les modificateurs dans `before-mouse-event` : un Maj+clic se reconnaît à la disposition `new-window`
  **sans `features`** que Chromium donne au lien, après un vrai clic gauche que main a vu (même geste que le
  bloqueur, consommé une fois). Un script peut imiter la disposition, mais n'obtient alors qu'un aperçu,
  moins qu'un onglet que le même geste ouvrirait ; `window.open` avec `features` (fenêtres de connexion) et
  `target=_blank` gardent leur comportement (un onglet).
- Toute URL passe par `isPeekableUrl` (= `isPageOpenableUrl` : http(s), about:blank). Une seule carte à la
  fois ; fermer (Échap dans la page ou la carte, clic hors de la carte, autre UI de l'overlay comme Ctrl+K)
  détruit la page. Focus rendu à la page source.
- « Ouvrir dans un onglet » : la page vivante devient un onglet à côté de la source **sans rechargement**
  (`TabManager.adoptPage`, même session ; historique de navigation conservé) ; si la page n'a pas encore
  d'adresse validée, l'URL est rouverte. « Ouvrir en vue scindée » fait de même puis `openSplit`.
- Historique : rien n'est enregistré pendant l'aperçu (ni historique, ni session) ; une fois promue en onglet
  d'une fenêtre normale, la page compte comme une visite. Fenêtre privée : jamais rien.
- Pas de commande de registre : la seule action utile (fermer) a déjà Échap, et la palette remplace l'aperçu.

**Téléphone** (`mobile/src/components/PeekSheet.tsx`). L'appui long sur un lien propose « Aperçu » : une
feuille du bas avec une seconde WebView (mêmes propriétés de sécurité et règles de navigation que l'onglet,
même mode privé, **aucun** script injecté ni message accepté). En-tête : titre, adresse, « Ouvrir dans un
onglet » (rouvre l'adresse affichée : une WebView ne change pas d'arbre), fermer ; glisser l'en-tête vers le
bas (au-delà d'un quart de la hauteur ou lancé, `shouldDismissSheet`) ou toucher le fond ferme ; retour
Android aussi. Animations Reanimated sur une seule valeur : `translateY` de la feuille, opacité du fond sur une
vue séparée ; aucune animation de mise en page (entering/exiting) dans ce composant.

**Limites.** Pas de menu contextuel, de recherche ni de zoom dans l'aperçu (bureau) ; un Maj+clic que Chromium
ne transforme pas en `new-window` (lien `download`, certains liens d'iframes) garde son comportement.

## ADR-028 — Raccourcis clavier personnalisables

**Contexte.** Les raccourcis venaient tous du registre des commandes (`src/shared/commands.ts`). L'utilisateur
veut changer la combinaison d'une commande, ou la retirer, sans que menu, palette et infobulles divergent.

**Décision.**
- Modèle : `settings.shortcuts` (ADR-011) = carte `CommandId → accélérateur | null` (null : aucun raccourci),
  **seulement** les commandes qui diffèrent du registre. Un correctif remplace toute la carte ; « Tout
  réinitialiser » de la section (ou `reset("shortcuts")`) la vide. `sanitizeShortcuts` garde les commandes
  connues, normalise les accélérateurs, et rejette : syntaxe invalide, touche sans Ctrl/Alt/Cmd (sauf F1–F24),
  combinaison réservée par un OS **sur l'une des plateformes** (le validateur ignore la plateforme :
  `CmdOrCtrl+Q` est Cmd+Q sur macOS, refusé partout ; un `Ctrl+Q` littéral passe), doublon.
- Module pur `src/shared/accelerators.ts` : analyse/normalisation (ordre canonique `CmdOrCtrl, Cmd, Super,
  Ctrl, Alt, Shift`, alias `Command`, `Option`, `Esc`, `+` → `Plus`…), résolution par plateforme (touches
  physiques Ctrl/Alt/Maj/Méta : base des conflits), affichage (⌃⌥⇧⌘ sur macOS, « Ctrl+Maj+… » ailleurs,
  « Win »/« Super »), touches réservées (Ctrl+Alt+Suppr, Alt+F4, Alt+Tab, Win+L, Cmd+Q, Cmd+Tab, Cmd+Espace,
  captures d'écran macOS…), et accélérateur d'une touche capturée : depuis `code` (touche physique, car Alt et
  Maj changent `key`), stocké **littéralement** pour cette machine (Ctrl reste `Ctrl`, Commande = `Cmd`, touche
  Windows = `Super`) ; les raccourcis ne sont pas synchronisés, aucune portabilité à préserver.
- Source unique : `effectiveAccelerator(id, plateforme, overrides)` = choix de l'utilisateur, sinon registre.
  Le menu (`commandMenuItems`, `src/main/commands.ts`), la palette, la page d'accueil et les infobulles
  (`platform.tip/shortcut/keys`) la lisent. Les alias cachés (F5, Ctrl+Plus, Ctrl+G, Ctrl+Maj+G) sont dans le
  registre (`effectiveAliases`) : abandonnés quand la commande est personnalisée ou qu'une autre commande prend
  la combinaison. Le menu est reconstruit quand `shortcuts` change. Aucun `before-input-event` ne déclenchait de
  commande : rien d'autre à brancher.
- Raccourcis fixes hors registre (Couper/Copier/Coller…, Ctrl+Tab, Ctrl+1…9, Ctrl+Alt+1…9) : `fixedShortcuts`,
  impossibles à prendre.
- Capture : cliquer sur un raccourci envoie `settings:shortcut-capture` (fenêtre de l'interface seulement, pas
  l'overlay) ; tant qu'elle dure, le `before-input-event` de l'interface **annule** chaque touche (ni accélérateur
  du menu, ni page) et la renvoie par `settings:shortcut-key`. Remise à zéro au rechargement de l'interface. Le
  `keydown` du DOM sert de repli. Échap annule, Retour arrière retire le raccourci, une combinaison refusée
  affiche la raison ; une combinaison déjà prise nomme la commande avec « Remplacer » (l'autre commande perd
  son raccourci, `null`) / « Annuler ». Rétablir par ligne, recherche (libellé, mots-clés, raccourci), groupes
  `COMMAND_GROUPS`.
- Synchronisation : les réglages synchronisés sont une liste choisie de champs (ADR-019), sans les préférences
  propres au bureau ; les raccourcis restent locaux.
- Téléphone : non applicable. React Native n'expose pas les touches d'un clavier matériel hors d'un `TextInput`
  (iPad `UIKeyCommand`, Android `onKeyDown` demandent du code natif, impossible dans Expo Go) : aucun code mobile.

## ADR-029 — Boosts : personnalisation par site

**Décision.** Un « boost » (comme dans Arc) personnalise un site : filtres de couleur, police, éléments
masqués, CSS et, en option, un script. Modèle pur et validé dans `src/shared/boosts.ts`, partagé par le
bureau et le téléphone ; stocké dans `boosts.json` (bureau) et `browser.boosts` (mobile), synchronisé.

- Modèle : `id`, `name`, `match` (hôte exact `news.exemple.fr`, ou `*.exemple.fr` = le domaine et ses
  sous-domaines ; `*.fr` refusé ; une URL collée est réduite à son hôte), `enabled`, `css` (20 000 caractères
  au plus), `zaps` (100 sélecteurs au plus), `font` (liste fermée de piles de polices système, aucune police
  téléchargée), `filters` (inversion, gris, sépia 0–100 %, luminosité et contraste 50–150 % : une page reste
  lisible), `script` (`enabled` faux par défaut, `code`, `allowPrivate`). L'éditeur reçoit un message en
  français plutôt qu'une troncature (`validateBoostInput`).
- Sélecteurs masqués : chacun devient sa propre règle `sel { display: none !important }` (un sélecteur invalide
  n'annule que la sienne) ; `isValidSelector` refuse ce qui sortirait de la règle (accolades, `;`, `@`, `<`,
  commentaires, sauts de ligne, barre oblique inverse finale, guillemets ou crochets non équilibrés) et ce qui
  masquerait la page entière (`html`, `body`, `*`, `:root`). Le CSS personnalisé vient en dernier.
- Plusieurs boosts peuvent viser une page : tous s'appliquent, du moins précis au plus précis (le plus précis
  gagne). Le panneau du site montre le plus précis (`siteBoost`).
- Bureau : `BoostService` (`src/main/boosts/service.ts`, renommé depuis les fonctions de `boosts/index.ts`). À
  chaque `dom-ready` (crochet `boostPage` de `TabManager`, conservé en fenêtre privée), le CSS passe
  par `webContents.insertCSS` ; les clés sont gardées par page pour que toute modification soit appliquée en
  direct (`removeInsertedCSS` puis nouvel `insertCSS`, sans recharger). Le script s'exécute dans un monde isolé
  (1007), jamais dans celui de la page, au chargement suivant ; en fenêtre privée seulement si `allowPrivate`.
- Outil « Masquer des éléments » (commande `zap-elements`, aussi dans le panneau du site) : un script en monde
  isolé (1008, sans preload) surligne l'élément survolé, intercepte le clic (événements de confiance seulement,
  les gestionnaires de la page ne le voient pas), calcule un sélecteur qui ne désigne que cet élément
  (`#id` stable, sinon classes stables + `:nth-of-type` en remontant) et résout sa promesse ; main le valide,
  l'ajoute au boost du site (créé au premier clic) et relance l'outil. Échap le termine.
- Interface : section « Boost » du panneau Infos sur le site (ADR-021 : créer, activer, filtres rapides, police,
  éléments masqués avec « Réafficher », outil, « Modifier ») et page interne `browser://boosts` (ADR-012 :
  liste, éditeur complet, CSS et script en chasse fixe, avertissement avant le script). Icônes Lucide `rocket`,
  `eraser`, `undo`.
- Fenêtres privées : les boosts s'appliquent (lecture), mais ne se créent ni ne se modifient depuis une fenêtre
  privée (écriture dans le profil, ADR-014) ; l'outil y est inactif.
- Synchronisation (ADR-019) : collection `boosts`, clé = id du boost. Le script ne voyage que s'il est activé ;
  un enregistrement reçu sans script garde le script désactivé local (`mergeBoosts`), qui ne quitte donc jamais
  l'appareil. Rien de secret, mais chiffré comme le reste.
- Consentement par appareil (post-audit) : un script reçu par la synchronisation, ou dont le code a changé
  ailleurs, arrive **désactivé** et `script.pending` ; il ne s'exécute qu'une fois activé sur cet appareil
  (« Script reçu d'un autre appareil — Activer ? » dans `browser://boosts` et la liste du téléphone,
  `confirmBoostScript`). Un code que l'appareil a déjà (saisi ou accepté ici) suit l'état activé/désactivé
  reçu. Un script en attente est retransmis tel que reçu (il ne désactive pas les autres appareils).
  `allowPrivate` n'est jamais synchronisé (toujours faux dans l'enregistrement, valeur locale conservée).
- Téléphone : `injectedJavaScriptBeforeContentLoaded` (cadre principal) pose une balise `<style>` avec le CSS
  des boosts de l'hôte courant et lance les scripts autorisés. L'app filtre par hôte avant d'injecter
  (`boostsForHost`) : une page ne reçoit jamais les boosts des autres sites. Le script de démarrage est
  construit pour l'hôte suivi par les évènements de navigation et ne fait rien sur un autre hôte ; il est
  réinjecté à chaque fin de chargement (pour un changement d'hôte), les scripts ne s'exécutant qu'une fois par
  document. Une modification est appliquée en direct par `injectJavaScript` (CSS seul). Limites
  assumées : react-native-webview n'a pas de monde isolé, un script activé s'exécute donc dans le monde de la
  page (via `eval`, bloqué par une CSP qui l'interdit) — le texte des réglages le dit ; pas d'outil pour masquer
  des éléments (pas de survol au doigt, sélection peu fiable) : les éléments masqués viennent du bureau par la
  synchronisation. Menu de la page « Boost du site » (activer, filtres rapides, police, réafficher) et liste
  dans les réglages (activer, supprimer).

## ADR-030 — Mises à jour automatiques et thèmes partageables

**Mises à jour (bureau).** `electron-updater` (fournisseur GitHub, `Mathieu-Lalande/browser`, releases
publiées seulement). La clé `build.publish` de `package.json` décrit ce fournisseur ; les builds restent en
`--publish never` : electron-builder écrit `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml` et
les `.blockmap` (téléchargement différentiel), que le workflow de release (ADR-023) envoie avec les paquets.
macOS gagne une cible `zip` (Squirrel.Mac ne met à jour qu'à partir d'un zip). Les `artifactName` ne changent
pas (le site en dépend).
- Testable : `electron-updater` est caché derrière l'interface `Updater` (`configure`, `check`, `download`,
  `install`, `onEvent`) ; `UpdateService` (`src/main/updates/service.ts`, sans Electron) planifie (premier
  contrôle 30 s après le démarrage, puis toutes les 6 h), lance lui-même le téléchargement (`autoDownload`
  d'electron-updater coupé) et tient l'état ; la machine à états pure `reduceUpdateStatus` est dans
  `src/shared/updates.ts` (`idle`, `checking`, `up-to-date`, `available`, `downloading`, `ready`, `manual`,
  `error`, `disabled`). Une mise à jour téléchargée reste `ready` quoi que disent les contrôles suivants, et
  s'installe aussi en quittant (`autoInstallOnAppQuit`). Erreurs : messages français fixes (le détail
  anglais d'electron-updater part dans la console).
- Jamais en développement : sans `app.isPackaged`, pas d'updater (`disabled`) ; `electron-updater` n'est
  importé (dynamiquement) que dans une app empaquetée. `--disable-updates` (commutateur explicite, honoré
  aussi empaqueté) coupe tout : le test de fumée du paquet l'utilise. Les e2e injectent un faux updater
  scénarisé, `BROWSER_TEST_UPDATER=available|none|error|manual`, crochet ignoré une fois empaqueté (ADR-018).
- Réglages : section `updates` (`autoDownload`, `channel` `stable`/`beta` → `allowPrerelease`) ; changer de
  canal relance un contrôle. *Paramètres → Mises à jour* : état (à jour, téléchargement x %, prête — redémarrer
  pour installer), dernière vérification, « Rechercher des mises à jour », « Télécharger » si le téléchargement
  automatique est coupé. Une mise à jour prête ajoute un bouton discret (icône Lucide `circle-arrow-up`) dans
  le pied de la barre latérale et « Redémarrer pour mettre à jour » au menu Fichier (reconstruit quand l'état
  change) ; commandes `check-updates` (palette) et `install-update` (menu seulement).
- Installations qui ne peuvent pas se remplacer : `canSelfUpdate` — Windows installé par NSIS (présence de
  `Uninstall Browser.exe`, pas la version portable), Linux lancé depuis l'AppImage (`APPIMAGE`), macOS signé
  *Developer ID* (`codesign -dv` ; une signature *ad hoc* ne suffit pas à Squirrel.Mac). Sinon l'état
  `manual` : « Mise à jour manuelle requise » avec un lien (nouvel onglet) vers la page de la release,
  construit à partir d'une version validée (semver), jamais d'une URL reçue.

**Thèmes partageables (bureau et téléphone).** Module pur `src/shared/theme-share.ts` :
- Un thème = `mode`, `accent`, `accent2`, `background`, `density`, `radius`, `font`, `shadows`, un nom
  facultatif (40 caractères) et le fond de la page d'accueil (`theme` ou `aurora` ; une image n'est jamais
  exportée ni écrasée : aucune URL ni image dans un thème). Les réglages d'accessibilité (animations, curseur,
  zoom) restent personnels.
- Formats : code `browser-theme:v1:<base64url du JSON>` (~250 caractères, ordre des champs fixe) et fichier
  `.browsertheme` (`{ format: "browser-theme", version: 1, theme }`). Décodage strict : version connue, champs
  inconnus refusés, chaque champ passe par le validateur des réglages (`validateSettingsField`) et doit en
  ressortir **inchangé** (un `#ABC` ou un rayon hors bornes est refusé, pas corrigé), 1 Ko pour un code, 4 Ko
  pour un fichier. Messages d'erreur en français.
- Galerie de 8 thèmes (`THEME_GALLERY`) dans *Paramètres → Apparence*, avec un aperçu (`MiniBrowser`) ;
  partage : code (copier), fichier (dialogue natif dans main, `theme:export-file` / `theme:import-file`, thème
  revalidé dans les deux sens), QR code (uqr, local) ; import par collage ou fichier → carte d'aperçu,
  « Appliquer » / « Annuler » ; appliquer = un correctif de réglages ordinaire.
- Téléphone (`mobile/src/lib/themeShare.ts`, `ThemeSettings.tsx`) : même galerie, partage par la feuille de
  partage du système (message + code), QR code, copier ; import par collage (un code au milieu d'un message
  partagé est retrouvé) ou scan (`PairingScanner` généralisé par préfixe, `browser-theme:` ici). Le téléphone
  n'applique visuellement que le mode et les deux couleurs ; les autres champs sont gardés dans ses réglages.

**Limites.** Pas de signature par défaut : mise à jour manuelle sur macOS, SmartScreen sur Windows. Le canal
bêta suit la dernière release GitHub, pre-release comprise ; revenir en stable n'installe pas de version plus
ancienne (`allowDowngrade` coupé). Le workflow de release n'a pas pu être exécuté ici.

**Intégrité des mises à jour (suite à donner, audit).** Sans signature, electron-updater ne vérifie que le
SHA-512 de `latest*.yml`, servi par la même release GitHub : quiconque peut publier une release (compte ou jeton
compromis) peut distribuer un binaire. Suite prévue : signer les builds (Authenticode sous Windows avec
`build.win.publisherName` renseigné, pour qu'electron-updater vérifie l'éditeur du nouvel installateur ;
*Developer ID* + notarisation sous macOS, que Squirrel.Mac vérifie) et protéger les secrets du workflow de release.

## ADR-031 — Options de la page, captures d'écran, enregistrement vidéo, balayage tactile

**Barre d'adresse.** Les boutons d'action (copier le lien, lecture, clé, zoom, favori, protections, options) sont
masqués par défaut et apparaissent en fondu au survol de la barre ou quand le focus clavier y est
(`:hover`, `:focus-within`). Opacité seulement : ils gardent leur place, l'URL ne bouge pas. Un état actif reste
visible (mode lecture actif, protections coupées, enregistrement en cours) ; le cadenas (infos sur le site) aussi,
c'est l'indicateur de sécurité.

**Options de la page.** Bouton « Options de la page » (Lucide `ellipsis`) au bout de la barre, commande
`page-options` (Ctrl+Maj+O) : popover du calque overlay (ADR-010, `OverlayKind` `page-options`) sous la barre.
Copier le lien, zoom en direct (− / % / +, le pourcentage remet le zoom par défaut, ADR-013), capture d'écran
(sous-menu), enregistrer une vidéo, mode lecture, version mobile, boost du site, infos sur le site, code QR de la
page (`uqr`, dessiné localement). Chaque action est une commande du registre exécutée par main sur l'onglet actif.

**Captures d'écran** (`src/main/capture/` : `CaptureService` et `TabRecorder`, renommés depuis `capture/index.ts`
et `capture/record.ts`, commandes `screenshot-visible` Ctrl+Maj+S, `screenshot-full` Ctrl+Alt+S,
`screenshot-element`) :
- zone visible : `webContents.capturePage()` ;
- page entière : protocole DevTools via `webContents.debugger` (`Page.getLayoutMetrics` puis
  `Page.captureScreenshot` avec `captureBeyondViewport` et un `clip` du document), sans faire défiler la page.
  Le débogueur n'est attaché que le temps de la capture (et pas détaché s'il l'était déjà) ; des DevTools ouverts
  sont un autre client et ne gênent pas. Hauteur plafonnée à 16 384 px (limite de Chromium) ; au-delà de
  64 mégapixels en sortie (taille CSS × densité de l'écran le plus dense × zoom), l'image est réduite
  (`captureScale`, `scale` du `clip`) pour borner la mémoire, page entière comme élément ;
- élément : un sélecteur en monde isolé (1009, comme l'outil des boosts) surligne l'élément survolé, intercepte le
  clic (événements de confiance seulement), Échap annule ; il renvoie le rectangle en coordonnées du document,
  validé et rogné par `elementClip` (`src/shared/capture.ts`), puis capture par le même `clip` CDP ;
- résultat : popover overlay `capture-result` en bas à droite (aperçu JPEG réduit en `data:`, taille, « Copier »
  via le presse-papiers d'Electron 44, « Enregistrer » : boîte de dialogue PNG, nom
  `Capture <site> <date>.png` dans le dossier des téléchargements). L'image reste dans main, une par fenêtre,
  oubliée à la fermeture du popover. Fenêtres privées : autorisé, rien n'est enregistré dans le profil.

**Enregistrement vidéo** (commande `record-video`, Ctrl+Alt+V, bascule). L'approche la plus simple et robuste
d'Electron 44 : la capture d'onglet de Chromium. L'interface (chrome) héberge un `MediaRecorder`
(`src/renderer/src/lib/recorder.ts`) ; main lui demande de démarrer, elle appelle `getDisplayMedia()`, et le
gestionnaire `setDisplayMediaRequestHandler` de la session de l'interface lui accorde une seule source : le
`mainFrame` de l'onglet demandé (image et son de l'onglet seulement, à sa taille). Sans demande en attente de main
pour cette fenêtre, la permission `media` (sans type caméra/micro) et la source sont refusées : aucune page, ni
l'interface d'elle-même, ne peut capturer l'écran. WebM (VP9/VP8 + Opus) ; à l'arrêt (bouton, commande, onglet
fermé), les octets reviennent à main (`recording:finish`, 1 Go au plus) qui propose
`Enregistrement <site> <date>.webm`. Indicateur toujours visible dans la barre d'adresse pendant l'enregistrement :
point rouge, minuteur (`formatDuration`), bouton d'arrêt (Lucide `circle-stop`). L'état vit dans main
(`BrowserState.recording`). `desktopCapturer` et l'abonnement aux images (`beginFrameSubscription`) ont été écartés :
le premier capture l'écran entier ou la fenêtre (interface comprise), le second est lourd (images brutes par IPC).

**Balayage tactile entre espaces.** La machine de `src/shared/space-swipe.ts` (ADR-022) reçoit aussi les
`PointerEvent` d'un doigt (`touchStart`/`touchMove`/`touchEnd`/`touchCancel`) : même verrouillage d'axe (sur 10 px,
un doigt tremble), suivi 1:1, seuil de 25 % et lancer ; le relâchement est le doigt levé (pas de minuteur ni de
traîne d'inertie), un doigt immobile avant de se lever n'est pas un lancer. `touch-action: pan-y` sur la barre
latérale : le navigateur garde le défilement vertical de la liste (et annule le geste par `pointercancel`), les
mouvements horizontaux nous reviennent. Les lignes ne se glissent-déposent plus au doigt (souris et stylet
inchangés) : au doigt, l'horizontale est le geste d'espace et la verticale le défilement.

## ADR-032 — Barre universelle (Ctrl+K et feuille de recherche mobile)

**Contexte.** La palette de commandes (ADR-010) et la feuille de recherche du téléphone mélangeaient
construction des résultats et rendu (`buildPalette`, un composant de 527 lignes), ne voyaient que l'espace affiché
et ne savaient ni calculer, ni convertir, ni ouvrir un réglage précis.

**Décision.** Un moteur pur partagé, `src/shared/omnibox/` :
- des **fournisseurs** (classes implémentant `Provider.query(texte, contexte) → Suggestion[]`) : onglets de tous les
  espaces (« Aller à l'onglet », change d'espace), favoris épinglés, favoris, historique (déjà classé par main),
  commandes du registre (raccourci effectif, ADR-028), réglages (index `settings-index.ts`, liens
  `browser://settings#section/ligne`), onglets des autres appareils, onglets archivés, Web (« Aller à … »,
  « Rechercher « x » » avec le moteur choisi, recherches passées tirées de l'historique : rien n'est envoyé au moteur
  pendant la frappe) ;
- des **réponses instantanées** calculées localement, en tête, Entrée copie : calculatrice (`calculator.ts`,
  analyseur descendant récursif, jamais `eval` ; nombres à virgule ou point, + - * / % ^ et parenthèses, tout le
  reste est refusé), conversions d'unités (longueur, masse, température, volume, vitesse, tailles de données ;
  orthographe exacte d'abord pour distinguer Mb/MB, sinon insensible à la casse si non ambiguë), heure d'un lieu
  (`Intl`, table de villes), bases (hexa, binaire, octal). Pas de devises : il faudrait des taux en ligne ;
- un **score** pur (`scorer.ts`) : correspondance floue par champ (titre > détail > mots-clés), poids par section,
  bonus de récence/rang, sections triées par leur meilleure ligne, réponse et adresse épinglées en tête, recherche
  Web en dernier, plafonds par section (relevés quand un filtre est actif) ;
- des **filtres** `@onglets @favoris @historique @commandes @réglages` (`@o @f @h @c @r`, `scopes.ts`) : « @r » suivi
  d'un espace devient une pastille (Retour arrière sur un champ vide la retire), « @ré » propose les filtres.

Bureau : `overlay/omnibox/` (contrôleur `controller.svelte.ts` + composants `UniversalBar`, `BarInput`,
`ScopeChips`, `ResultList`, `ResultRow`, `ConfirmPanel`, `BarFooter`). Entrée : ici ; Ctrl/⌘+Entrée : nouvel
onglet ; Maj+Entrée : côte à côte ; Alt+Entrée : arrière-plan ; Tab : complète la ligne choisie. Canaux
`omnibox:tabs` (onglets de tous les espaces), `omnibox:show-tab`, `omnibox:open` (texte ≤ 8 Kio, disposition
énumérée, repasse par `normalizeInput` ; une page interne réutilise son onglet et suit le lien profond),
`omnibox:copy` (≤ 1 Kio, presse-papiers de main). L'historique d'un ancien texte n'est jamais affiché (garde de
requête). Seule l'ouverture est animée (`--motion-fast`) : les résultats apparaissent sans fondu.

Mobile : `buildSheet` (`mobile/src/lib/searchSheet.ts`) appelle le même moteur, avec un fournisseur d'actions
propres au téléphone et un filtre de commandes ; pas de réglages (l'écran de réglages du téléphone a sa propre
disposition).

**Conséquences.** `src/shared/palette.ts` disparaît. Les liens profonds `browser://…#section/ligne` ne sont acceptés
que s'ils sont de la forme `[a-z0-9_-]+(/[a-z0-9_-]+)?` et restent, comme toute page interne, hors d'atteinte des
pages web (ADR-012). Un test vérifie que chaque entrée de l'index a son ancre (`data-setting`) dans la page.

## ADR-033 — Menus de l'application, de la barre latérale et des pages ; gestes sur la page

**Contexte.** Zen (et Firefox, Chrome) offre un menu « … » complet, des menus contextuels sur la barre latérale et
les espaces, des actions de page (imprimer, enregistrer, code source, envoyer à un appareil) et des gestes au pavé
tactile (pincer pour zoomer, balayer pour revenir). Il fallait l'équivalent sans multiplier les sources de vérité.

**Décision.** Des **modèles de menus purs** (`src/shared/menus.ts`, testés) construits depuis le registre de
commandes : chaque entrée est une commande (`kind: "command"`, libellé, icône et raccourci effectif ADR-028), sauf ce
qui n'existe que dans un menu (liens d'historique/favoris, actions d'espace). Nouvelles commandes : `print`,
`save-page`, `view-source` (Ctrl+U), `reopen-closed-tab` (Ctrl+Maj+T), `select-all-tabs`, `toggle-compact-mode`,
`toggle-sidebar-position`, `toggle-fullscreen` (F11 / ⌃⌘F), `edit-space`, `app-menu`, `open-sync`,
`keyboard-shortcuts`, `about`, `report-issue`, `quit` ; toutes dans le menu de l'application (leurs raccourcis).
- **Menu « … »** (bouton en tête de la rangée de navigation) : popover `app-menu` du calque overlay (ADR-010), rendu
  par `MenuList.svelte` (récursif, sur `Menu`/`MenuItem`) : flèches dans un niveau, sous-menu au survol, → / Entrée,
  ← / Échap pour revenir. En-tête Synchronisation (état + « Se connecter »/« Synchroniser »), rangée Zoom (− % + et
  plein écran, le menu reste ouvert). « Traduire la page » : commande `translate-page` depuis ADR-036 (grisé « Bientôt » avant).
  « Tout l'historique… » ouvre la barre universelle (pas de page d'historique) ; une commande qui ouvre sa propre UI
  flottante remplace le menu dans le calque (`command-palette` n'est plus une bascule que pour elle-même).
- **Menus natifs** (comme ceux des onglets et des pages) : espace vide de la barre latérale (`sidebar:context-menu`)
  et pastilles d'espace (`spaces:context-menu` : renommer et icône/couleur ouvrent l'éditeur de l'interface,
  déplacer à gauche/droite `moveSpace`, supprimer après confirmation `dialog`). Les raccourcis y sont des indications
  (`registerAccelerator: false`) : le menu de l'application reste le seul à les installer.
- **Menu de la page** : un menu natif ne sait pas dessiner une rangée d'icônes ; Précédent/Suivant/Actualiser/Favori
  viennent donc en tête avec leurs raccourcis, puis Enregistrer la page sous…, Tout sélectionner, Capture d'écran ▸,
  Afficher le code source, Envoyer à un appareil ▸, et Inspecter.
- **Enregistrer la page sous…** : boîte de dialogue puis `webContents.savePage` (HTML complet ou MHTML) vers le fichier
  choisi : aucune entrée de téléchargement ni dossier mémorisé, donc rien dans le profil depuis une fenêtre privée.
  **Code source** : `view-source:` d'une page http(s) seulement (`isViewSourceUrl`), accepté par `isNavigableUrl` et
  la barre d'adresse mais jamais par `isPageOpenableUrl` ; Chromium refuse les navigations view-source initiées par
  une page.
- **Rouvrir l'onglet fermé** : pile en mémoire par liste d'onglets (25), jamais écrite.
- **Sélection d'onglets** : Ctrl/⌘+clic ou « Sélectionner tous les onglets », barre d'actions (nouveau dossier,
  déplacer vers un espace, fermer, annuler ; Échap), réinitialisée au changement d'espace.
- **Mode compact** (`layout.compactMode`) : la barre latérale devient un rail d'icônes (`CompactRail`) qui se déplie
  en barre complète au survol (même minuterie que le mode zen, la page suit), le zen l'emporte.
- **Envoyer à un appareil** : collection de synchro `sent` (le nom « sent-tabs » n'est pas un nom de collection
  valide) : `{ to, from, fromName, url, title, sentAt }` chiffré de bout en bout comme le reste, http(s) seulement,
  expiré après 7 jours (il sort de l'instantané, donc est supprimé partout). Le destinataire le voit dans
  `SyncStatus.received` ; le bureau l'ouvre en arrière-plan dans une fenêtre normale (notification), le téléphone
  demande (« Ouvrir » / « Plus tard ») et le garde sous « Autres appareils » ; une fois montré il est supprimé
  (`dismissReceivedTab`). Jamais depuis une fenêtre privée.

**Gestes.** *Pincer / Ctrl+molette* : Chromium les rapporte en `zoom-changed` (le zoom visuel reste désactivé,
limites 1:1 par défaut dans Electron) ; ils passent par le zoom par site (ADR-013), à raison d'un cran au plus toutes
les 110 ms (`PinchZoomSteps`) pour qu'un pincement ne saute pas aux extrêmes ; l'indicateur de zoom de la barre
d'adresse les montre. Comportement unique, assumé : tout pincement est un zoom de page ; un écran tactile n'a pas de
zoom visuel. *Balayage à deux doigts* : `input-event` n'a pas les deltas de molette et les pages n'ont pas de preload ;
un guetteur en monde isolé 1010 (`page-swipe-script.ts`) classe chaque rafale de molette de confiance : seule une
rafale horizontale en pixels (pavé tactile) que l'élément sous le pointeur, ses ancêtres et le document ne peuvent
plus faire défiler dans ce sens est signalée, par `console.debug` préfixé d'un secret tiré au lancement (invisible du
monde principal : une page ne peut pas simuler un geste ; rien n'est émis pendant un défilement vertical). Main
(`page-swipe.ts`) les lit sur `console-message` (cadre principal), les passe à `PageSwipe` (`page-gestures.ts`, pur,
qui réutilise l'automate de `SpaceSwipe` : verrou d'axe, suivi 1:1, seuil 120 px ou lancer, traîne d'inertie avalée)
et montre une flèche dans le calque overlay (popover `page-swipe`, sans prendre le focus) ; le calque couvrant alors
la page, il renvoie les molettes suivantes à main (`page-swipe:wheel`). macOS garde aussi l'événement natif `swipe`.

**Conséquences.** Les messages du guetteur apparaissent au niveau « Verbose » des outils de développement de la page.
Une page qui gère elle-même le défilement horizontal par script (sans débordement CSS) peut voir un balayage
naviguer au bord : comme dans Chrome.

## ADR-034 — Nouvel onglet personnalisable (widgets)

**Contexte.** La page d'accueil (horloge, recherche, sites fréquents, deux interrupteurs) devait devenir une page
qu'on arrange soi-même, comme les « nouveaux onglets » des navigateurs récents, sur le bureau et le téléphone.

**Décision.** Un **modèle pur** `src/shared/start-widgets.ts` : `settings.startPage.widgets` est une liste ordonnée
de `{ id, kind, size, options }` (12 au plus), validée par `sanitizeWidgets` (types inconnus, identifiants invalides
ou en double, second exemplaire d'un widget unique, tailles non proposées : écartés ou corrigés ; options validées
champ par champ par type). Catalogue `WIDGET_CATALOG` : horloge/salutation, recherche, sites fréquents (avec épingles
modifiables), favoris, autres appareils (synchro), notes rapides, météo, calendrier, à faire, « Reprendre »
(onglet fermé + onglets archivés). Opérations pures (ajouter, retirer, déplacer, décaler d'un cran, redimensionner,
options), dispositions « Minimal », « Productif », « Complet » (qui réutilisent les widgets déjà présents, donc leurs
notes) et réinitialisation. Les anciens `showClock`/`showTopSites` sont migrés à la lecture.
- **Tailles** : S = une colonne, M = deux, L = toute la rangée, sur une grille de 4 colonnes (2 sur une page étroite,
  requêtes de conteneur). L'horloge et la recherche sont dessinées sans carte.
- **Mode édition** (bouton « Personnaliser ») : glisser-déposer des cartes, flèches pour déplacer la carte focalisée
  (annoncé par une région `aria-live`), Suppr pour retirer, Entrée pour les options (popover dans la page : la page
  d'accueil est dessinée par l'interface, aucune vue native au-dessus), galerie « Ajouter un widget », Échap ou
  « Terminé » pour sortir. Contenu inerte pendant l'édition. Animations `flip` de 140 ms, 0 si mouvements réduits.
- **Enregistrement** : `StartLayout` applique les modifications tout de suite et les envoie aux réglages,
  immédiatement ou après 400 ms de pause pendant la saisie (notes, tâches), et à la fermeture de la page.
- **Synchronisation** : la disposition se synchronise avec les réglages (ADR-019), **sans** le texte des notes ni
  les tâches (`withoutLocalContent`), que l'application d'un enregistrement distant remet en place
  (`withLocalContent`, par identifiant).
- **Météo** : Open-Meteo, sans clé. Recherche de ville (API de géocodage) et prévisions demandées par main
  (`weather:places`, `weather:forecast` ; CSP de l'interface inchangée) via la session en mémoire sans cookies de
  l'image d'accueil, délai de 8 s, cache de 30 min (`WeatherClient` partagé, client HTTP injecté) ; analyse des
  réponses par `parsePlaces`/`parseForecast` (JSON non fiable). Le widget n'est dans aucune disposition par défaut :
  aucune requête tant qu'on ne l'ajoute pas ; mentionné dans la section Confidentialité.
- **Fond dynamique** (`startPage.background = "dynamic"`) : deux maillages des couleurs d'accent qui dérivent
  lentement ; immobiles quand les mouvements sont réduits (règle globale).
- **Fenêtres privées** : la page fonctionne, mais les widgets qui révèlent des habitudes (sites fréquents, autres
  appareils, « Reprendre ») ne s'affichent pas, et toute modification reste en mémoire : rien n'est enregistré.
- **Téléphone** (`mobile/src/components/StartPage.tsx`, `StartWidgets.tsx`, `lib/startWidgets.ts`) : même liste,
  types pris en charge : horloge, recherche, sites fréquents, favoris, autres appareils, notes, à faire, météo
  (calendrier et « Reprendre » sont ignorés mais conservés). Appui long pour l'édition ; la poignée d'une carte se
  glisse (`usePanGesture` + Reanimated : translation et opacité sur la même vue, pas d'animation de mise en page),
  point d'arrivée par `dropIndex` ; lecteurs d'écran : actions « Monter », « Descendre », « Retirer ».

**Conséquences.** `MAX_SETTINGS_PATCH` passe à 96 Ko (notes et tâches dans les réglages). Les notes vivent dans
`settings.json` (en clair, comme le reste des réglages). Un ancien appareil qui synchronise `showClock: false` sans
liste de widgets peut réimposer la disposition par défaut sans horloge.

## ADR-035 — Pause des médias (mini-lecteur)

**Contexte.** Une musique ou une vidéo qui joue dans un onglet qu'on a quitté oblige à le retrouver pour la mettre en
pause. Il fallait un mini-lecteur, sur le bureau et le téléphone, sans preload ni script dans le monde de la page.

**Décision.** Un **modèle pur** `src/shared/media.ts` : `parseMediaProbe` (relevé non fiable de la page : textes
nettoyés et bornés, durées finies, pochette choisie par `pickArtwork` parmi les URL http(s) ou `data:` matricielles),
`buildSource`/`sameSource` (une source par onglet : titre, sous-titre, pochette, lecture, position et instant de
lecture, `changedAt`), `miniPlayerSources` (sauf les onglets à l'écran, en lecture ou en pause depuis moins de
5 minutes, la plus récente d'abord), `currentPosition`/`formatMediaTime`, `isMediaAction`.
- **Main** (`src/main/media/`) : `MediaHub` par fenêtre. `TabManager` relaie `media-started-playing`/`media-paused`
  (crochet `media`, gardé en fenêtre privée) ; le hub sonde alors la page dans le **monde isolé 1011** (`probe.ts` :
  `navigator.mediaSession.metadata`, élément `<audio>`/`<video>` suivi — le dernier lancé, retenu par un écouteur
  `play` en phase de capture dans le monde isolé —, durée, position, pause), puis toutes les secondes **tant que
  quelque chose joue** seulement. La pochette est téléchargée par main avec la session de l'onglet (bouclier,
  HTTPS-Only, GPC via `faviconRequestUrl`), 256 Ko au plus, et passée en `data:` (ADR-018) ; à défaut, le favicon.
  N'est envoyé à l'interface (`media:changed`) que ce qui change ; l'interface extrapole la position.
- **Commandes** (`media:*`, vérifiées par le registre IPC, émetteur = fenêtre connue) : lecture/pause, recul/avance
  de 10 s, position, exécutées dans le monde isolé avec geste utilisateur ; son (`TabManager.toggleMute` de l'espace
  de l'onglet) ; image dans l'image (script existant) ; « Aller à l'onglet » (change d'espace au besoin) ; fermer
  (pause + masquée jusqu'à la prochaine lecture). Les gestionnaires `mediaSession.setActionHandler` de la page vivent
  dans son monde : on ne peut pas les appeler sans y injecter de script (exclu, ADR-003). « Précédent/suivant »
  deviennent donc **« Reculer/Avancer de 10 s »**. Les **touches multimédias** matérielles passent, elles, par le
  service de session média de Chromium, qui vise la dernière session active : rien à ajouter (pas de
  `globalShortcut`).
- **« Tout mettre en pause »** (`pause-all-media`, <kbd>Ctrl/⌘ Alt P</kbd>, registre des commandes) : toutes les
  sources de toutes les fenêtres.
- **Interface** : `MiniPlayer.svelte` en bas de la barre latérale, au-dessus du pied (dans la barre, donc jamais
  sous une vue native) : pochette, titre/artiste coupés par des points de suspension, barre de progression
  (`input type=range`), lecture/pause, avancer, image dans l'image (vidéo), fermer ; avec plusieurs sources, un
  compteur déplie la liste au-dessus de la carte. Mode compact : un bouton lecture/pause dans le rail. Icônes Lucide,
  animations `--motion-*`.
- **Fenêtres privées** : même fonctionnement, rien n'est écrit (le hub vit avec les pages).
- **Téléphone** : seul l'onglet affiché joue (les autres WebView sont masquées et suspendues par le système), donc
  pas de hub : `mobile/src/lib/media.ts` injecte après chaque chargement un guetteur avec un **nonce aléatoire par
  document** (`MediaWatchGuard`, même règle que la capture des mots de passe d'ADR-025 : message refusé hors de
  l'origine du document ou avec un autre nonce), validé par `parseMediaProbe`. `MiniBar.tsx` au-dessus de la barre
  d'outils : lecture/pause et fermer (script injecté au toucher).

**Conséquences.** Les médias dans un cadre d'une autre origine ou dans un objet `Audio` hors du DOM ne sont pas
pilotables (la source est affichée, ses boutons lecture et position désactivés ; le son se coupe depuis l.onglet) ;
« Tout mettre en pause » ne les atteint pas. Une page peut annoncer des métadonnées fausses : elles ne servent qu'à
l'affichage, en texte.

## ADR-036 — Traduction des pages (bureau et téléphone)

**Contexte.** Traduire une page sans moteur embarqué (des centaines de Mo par paire de langues) : il faut un service
en ligne, donc **le texte de la page quitte l'appareil**. Choix par défaut (le propriétaire n'en a pas imposé) :
**désactivée**, service choisi par l'utilisateur, avertissement clair dans les paramètres et à la première traduction.

**Cœur pur partagé** (`src/shared/translate/`, testé, importé tel quel par le téléphone) :
- `TranslationProvider` (construire la requête HTTP, analyser la réponse, aucune E/S) : `DeepLProvider` (`/v2/translate`
  JSON, en-tête `DeepL-Auth-Key`, hôte Free ou Pro, cible `EN-US`/`PT-PT`), `LibreTranslateProvider` (`POST /translate`,
  `q` en liste, `format: "text"`, clé facultative ; serveur https, ou http signalé « non chiffré »),
  `GoogleTranslateProvider` (v2, clé dans l'en-tête `x-goog-api-key`, jamais dans l'URL, `format: "text"`). Statuts
  401/403/456/429/400/5xx et réponses malformées → `TranslationError` au message français ; une réponse au nombre de
  traductions différent est refusée (jamais de décalage).
- `Translator` : découpe par nombre et taille (`chunkTexts`, limites propres à chaque service), requêtes une par une,
  cache LRU (une page qui redessine le même texte ne coûte rien), `fitTranslation` (texte borné, sans caractères de
  contrôle). **Segments HTML-sûrs** : seuls des nœuds texte partent, et la traduction est réécrite par `nodeValue`,
  jamais en HTML : une réponse hostile reste du texte.
- Langues : `<html lang>` puis `Content-Language` (`pageLanguage`, sous-étiquette primaire) ; rien de déclaré → source
  « auto », détectée par le service (langue renvoyée affichée ensuite). Cible : réglage, sinon langue du système
  (`app.getPreferredSystemLanguages`, `Intl` sur le téléphone), sinon français.
- Règles (`rules.ts`) : toujours traduire / ne jamais traduire une langue (exclusives), jamais pour un site (hôte sans
  « www. », sous-domaines compris) → `auto` / `offer` / `none`.
- Script de page `TRANSLATE_WALKER` (source ES2018 en chaîne : Hermes ne garde pas le source des fonctions) : nœuds
  texte du `body` hors `script`, `style`, `code`, `pre`, `kbd`, champs, `contenteditable`, `aria-hidden`,
  `translate="no"`/`.notranslate`, SVG/MathML ; lots **partie visible d'abord** ; espaces autour conservés ; `apply` ne
  réécrit qu'un nœud qui contient encore le texte envoyé ; `MutationObserver` (anti-rebond 400 ms, 20 000 nœuds au
  plus) pour le contenu ajouté ; `restore` remet le texte exact d'origine (ce que la page a changé entre-temps reste).

**Bureau.** Main fait les appels (`fetch` de Node : hors de toute session de navigation, donc ni cookies ni extensions
ni cache ; délai 15 s, pas de redirection, réponse ≤ 2 Mo). Clés dans `translate-keys.json`, un bloc chiffré par
`safeStorage` comme les mots de passe (ADR-025) ; sans chiffrement du système, rien n'est enregistré ; l'interface sait
seulement quelles clés existent. Le script tourne dans le **monde isolé 1012** (rien d'exposé à la page, pas de preload,
ADR-003) ; ses résultats reviennent comme valeurs de retour. `PageTranslator` (une par fenêtre) lit la langue à chaque
`dom-ready`, applique les règles, mène la `TranslationRun` du document (annulée par un nouveau document ou « Afficher
l'original », 200 vagues de contenu nouveau au plus) et publie `TabState.translation` / `translated`. Interface : bouton
de la barre d'adresse (page dans une autre langue), popover overlay `translate` (langues, avertissement, règles,
« Afficher l'original »), commande `translate-page` (Ctrl+Alt+T / ⌥⌘T, bascule), menu « … », menu contextuel de la
page, section « Traduction » des paramètres (service, formule DeepL, serveur, clé, « Tester », langue cible, règles).
**Consentement** : `settings.translate.acknowledged` (une fois) ; **fenêtres privées** : confirmation à chaque fenêtre,
règles copiées puis gardées en mémoire, jamais écrites ; aucune clé ne s'y enregistre.

**Téléphone.** Mêmes services ; clés dans `expo-secure-store`. Le walker partagé est injecté à la demande (menu de la page :
« Traduire la page » / « Afficher l'original ») avec un **nonce aléatoire par demande** gardé dans sa fermeture ;
`TranslateBridge` n'accepte que les lots portant ce nonce, venus de l'origine du cadre principal, jusqu'au chargement
suivant (même règle que la capture des mots de passe d'ADR-025) ; les lots sont revalidés (`sanitizeSegments`) et
traduits par l'application, réécrits en texte. Source détectée par le service.

**Conséquences.** Le texte visible part chez un tiers (DeepL, Google ou le serveur LibreTranslate choisi), d'où
l'option désactivée par défaut et l'avertissement. Pas de traduction des attributs (`title`, `alt`, `placeholder`) ni
des iframes ; une phrase coupée par du balisage (`<b>`) est traduite morceau par morceau. Sur le téléphone, la page voit
le script et peut lire le nonce : il ne sert qu'à écarter les autres cadres, une page ne pouvant de toute façon faire
traduire que son propre texte.

## ADR-037 — Notes et surlignages (bureau et téléphone)

**Contexte.** Surligner des passages d'une page, les annoter, les retrouver à chaque visite (même si la page a un peu
changé) et les exporter, sans donner aux pages ni preload ni accès à ces données.

**Modèle pur** (`src/shared/annotations/`, testé, importé tel quel par le téléphone) : un surlignage est une citation
façon W3C `TextQuoteSelector` (`exact`, `prefix`/`suffix` de 32 caractères, position `start` comme indice), une couleur
parmi quatre (jaune, vert, bleu, rose ; teintes claires/sombres selon `prefers-color-scheme` de la page), une note
facultative et ses dates ; une note de page est un texte libre par URL. Les pages sont identifiées par leur URL http(s)
sans fragment ni identifiants (`annotationUrl`) ; tout ce qui vient du stockage, de l'IPC, d'une page ou de la synchro
passe par `sanitize*` (tailles bornées, caractères de contrôle retirés). Export Markdown (échappé, groupé par site) et
JSON (même forme que `annotations.json`).

**Ancrage** (`page-script.ts`, chaînes ES2018 : Hermes ne garde pas le source des fonctions ; les tests évaluent ce même
code) : texte normalisé du `body` (nœuds texte dans l'ordre, scripts/styles/champs/`hidden` exclus, espaces fusionnés, une
espace entre blocs). On cherche toutes les occurrences exactes, départagées par le contexte puis la distance à l'indice ;
à défaut, une correspondance approchée (distance d'édition, algorithme de Sellers ; début et fin séparément pour les longues
citations, longueur à ±25 %), au plus 5 essais approchés par surlignage et par document. Le passage est enveloppé de
`<mark data-browser-hl>` en déplaçant les nœuds texte (jamais d'HTML analysé) ; un `MutationObserver` (anti-rebond 600 ms,
1,5 s au moins entre deux passes) réancre les passages manquants.

**Bureau.** L'annotateur tourne dans le **monde isolé 1013** (ADR-003), injecté seulement quand la page a des surlignages ou
qu'on en crée un ; le CSS par `insertCSS`. Un clic sur un passage (événement de confiance, hors liens et contrôles, sans
sélection) remonte par `console.debug` préfixé d'un secret par exécution (même canal que le geste de balayage, ADR-033) ;
main vérifie que l'id appartient bien à la page. `PageAnnotator` (un par fenêtre) dessine les pages à chaque `dom-ready` et
après chaque changement, capture la sélection (commande `highlight-selection`, Ctrl+Maj+H, dernière couleur ; menu
contextuel « Surligner » et ses couleurs), ouvre le popover overlay `annotation` (couleur, note, copier, supprimer).
Panneau « Notes de la page » (commande `toggle-notes-panel`, Ctrl+Alt+N) : il réduit la zone `viewport` (ADR-010), du
côté opposé à la barre latérale. Page interne `browser://notes` (ADR-012) : groupée par site, recherche, filtres de
couleur, export par boîte d'enregistrement de main, suppression. Barre universelle : fournisseur `AnnotationsProvider`,
filtre `@n`. Stockage `annotations.json` (`JsonFile` du profil).

**Synchro** : collection `annotations` (enregistrements `h:<id>` et `n:<url>`, chiffrés de bout en bout, LWW par
enregistrement), **facultative** (`settings.annotations.sync`, désactivée par défaut). Le moteur saute une collection dont
`CollectionAdapter.enabled()` renvoie faux : ni lecture ni envoi, donc aucune suppression propagée tant qu'elle est
désactivée.

**Fenêtres privées** (ADR-014) : rien n'est écrit dans le profil ; la fenêtre a son propre carnet **en mémoire**, signalé
dans le panneau et sur `browser://notes`, perdu à sa fermeture, jamais synchronisé.

**Téléphone.** « Surligner » dans le menu de sélection (`menuItems`/`onCustomMenuSelection` de react-native-webview), onglets
normaux seulement. L'annotateur partagé est injecté à chaque document avec un **nonce aléatoire** gardé dans sa fermeture ;
`AnnotateBridge` n'accepte que les messages portant ce nonce, venus de l'origine du cadre principal, jusqu'au chargement
suivant (règle d'ADR-025). Toucher un passage ouvre une feuille (couleur, copier, supprimer) ; liste, recherche et
interrupteur de synchro dans Paramètres, « Notes et surlignages ».

**Conséquences.** Envelopper du texte découpe des nœuds texte : un framework qui en garde des références peut réécrire
le passage (il est alors réancré). Pas d'ancrage dans les iframes ni le Shadow DOM. Sur le téléphone, la page voit
l'annotateur (pas de monde isolé) ; elle ne peut au pire que surligner son propre texte ou signaler un clic sur un id
que l'application vérifie.

## ADR-038 — Aperçu des onglets au survol et thème dynamique

**Contexte.** Retrouver un onglet parmi beaucoup d'autres sans l'ouvrir ; laisser la couleur du site habiller
l'interface sans jamais sacrifier la lisibilité. La barre latérale ne peut pas dessiner au-dessus des pages
(`WebContentsView` natif, ADR-010) : la carte vit dans le calque overlay.

**Aperçu au survol** (réglage `layout.tabHoverPreview`, « Aperçu des onglets au survol », activé par défaut).
- **Intention** (interface, `src/renderer/src/lib/tab-preview.ts`, action `use:tabPreview` sur les onglets, les
  onglets épinglés, les tuiles de favoris et les icônes du rail compact) : `HoverIntent` pur
  (`src/shared/tab-preview.ts`) — 400 ms avant la première carte ; tant qu'une carte est affichée (ou 300 ms
  après), la ligne suivante s'affiche aussitôt ; quitter une ligne masque après 60 ms (pas de clignotement d'une
  ligne à l'autre). Défilement, molette, glisser, touche, clic ou perte du focus masquent et réarment le délai.
  Avec l'aperçu actif, les infobulles natives (`title`) des lignes disparaissent (la carte dit la même chose).
- **Main** (`src/main/tab-preview.ts`, `TabPreviews` par fenêtre, canaux `tab-preview:show`/`hide`, chrome
  seulement, arguments vérifiés) : construit la carte (titre, hôte, favicon, badges son/sourdine/« En veille »)
  et la place à côté de la ligne (`previewCardBounds` : à droite d'une barre à gauche, à gauche d'une barre à
  droite, dans la fenêtre). Une tuile de favori sans onglet ouvert montre titre, adresse et icône.
- **Calque overlay passif** : genre `tab-preview`, comme l'indicateur de balayage (ADR-033) il ne prend jamais le
  focus et sa fermeture n'en déplace aucun ; la vue overlay ne couvre **que la carte et sa marge d'ombre**
  (`OverlayRequest.region`), donc la barre latérale garde le pointeur. Les mises à jour (autre ligne, miniature
  arrivée) modifient la même carte sans la remonter : apparition en `--motion-fast` (≤ 120 ms, 0 si mouvements
  réduits), déplacement instantané. La carte ne s'ouvre pas par-dessus une autre interface flottante.
- **Miniatures** : `webContents.capturePage()` ne vaut que pour une page attachée (à l'écran). Main capture donc
  l'onglet affiché 700 ms après son affichage ou la fin de son chargement, et l'onglet survolé s'il est visible et
  que sa miniature a plus de 30 s ; réduite à 2× la largeur de la carte, JPEG. `ThumbnailCache` (pur, testé) :
  une entrée par onglet **et par page** (une navigation hors ancre la supprime : jamais l'image d'une autre page),
  40 au plus, onglets fermés oubliés ; une entrée expirée reste affichée (un onglet en veille ne peut pas être
  recapturé) et n'est que « à refaire ». Sans miniature (veille, jamais affiché) : favicon, titre, adresse,
  « En veille ». Les miniatures ne quittent pas la mémoire, **fenêtres privées comprises**, et n'atteignent
  l'overlay qu'en `data:image/…` (CSP `img-src 'self' data:`, vérifié par `isThumbnailUrl` des deux côtés).
- **Téléphone** : pas de survol ; la vue des onglets montre déjà des cartes. Rien à faire.

**Thème dynamique** (réglage `appearance.dynamicTheme`, « Thème dynamique », désactivé par défaut).
- Source : l'événement Electron `did-change-theme-color` (le nom actuel de `page-theme-color-updated`), relevé par
  `TabManager` dans `TabState.themeColor` (`normalizeThemeColor`, `#rrggbb`) ; sinon la couleur dominante du
  favicon (déjà en `data:`, ADR-018), décodée par un canevas dans l'interface (`lib/dynamic-accent.ts`, mise en
  cache) puis calculée par `dominantColor` (pur : pixels opaques et colorés groupés par teinte OKLCH, pondérés par
  la chroma ; gris, blanc et noir ignorés). `siteAccent` garde la première couleur **digne d'un accent**
  (chroma ≥ 0,045, ni presque noire ni presque blanche), sinon `null` : la couleur de l'espace, sinon l'accent
  du thème.
- Contraste : la couleur passe par `accentVariables` comme une couleur d'espace (luminosité bornée, `--accent-text`
  ajusté au niveau AA, encre la plus lisible sur l'accent). Seulement pour une page web (`http(s)`) : page
  d'accueil et pages internes gardent la couleur de l'espace.
- Transition : `animateAccent` mélange en OKLab image par image pendant `--motion-base` (0 si mouvements
  réduits) ; la dernière image vaut exactement la cible. Pas de `@property` : enregistrer `--accent` comme
  `<color>` le ferait lire en `rgb()` partout.
- Fenêtres privées : jamais (leur thème doit rester reconnaissable, ADR-014).
- **Téléphone** : non fait ; il faudrait un guetteur de `meta[name=theme-color]` injecté avec nonce par document
  (règle d'ADR-025/035) et le relayer à `ThemeProvider`. `siteAccent`/`accentVariables` sont déjà partagés.

**Conséquences.** Un onglet en arrière-plan jamais affiché depuis son chargement n'a pas de miniature. Une page
peut choisir sa couleur : elle ne change que l'accent, toujours ramené à un contraste lisible.

## ADR-039 — Navigateur principal : navigateur par défaut, lecteur PDF, historique, import

**Contexte.** Pour remplacer le navigateur de tous les jours, il manquait quatre choses : recevoir les liens et
fichiers du système, afficher les PDF, retrouver et effacer son historique, et reprendre ses données d'un autre
navigateur. Chacune touche au modèle de sécurité (ADR-003, ADR-018) : rien de ce qui arrive de l'extérieur ne
doit ouvrir plus qu'une page ne le peut.

**Navigateur par défaut.**
- Déclaration : `build.protocols` (`http`, `https`) et `build.fileAssociations` (`.html .htm .xhtml .pdf`,
  rôle *Viewer*, rang *Alternate*) d'electron-builder, d'où `CFBundleURLTypes`/`CFBundleDocumentTypes` sous macOS ;
  `linux.mimeTypes` (`x-scheme-handler/http(s)`, `text/html`, `application/pdf`) dans le `.desktop`. Windows 10/11
  ne liste dans « Applications par défaut » qu'un client `StartMenuInternet` avec `Capabilities` et une entrée
  `RegisteredApplications` : écrits par `customInstall` de `build/installer.nsh` (ProgIds `BrowserURL`,
  `BrowserHTML`, `BrowserPDF`, `HKCU` ou `HKLM` selon le mode d'installation), retirés à la désinstallation (pas
  lors d'une mise à jour).
- `DefaultBrowserService` (`src/main/default-browser/service.ts`, port `DefaultClientPort` testable) : état
  « par défaut / pas par défaut / indisponible ». Une exécution non empaquetée ne s'enregistre jamais (elle
  détournerait les liens du développeur). Windows : aucune application ne peut se déclarer par défaut, le
  bouton ouvre `ms-settings:defaultapps?registeredAppUser=Browser` et l'état lit le choix réel de l'utilisateur
  (`app.getApplicationNameForProtocol`, la clé que vérifie `isDefaultProtocolClient` étant écrite par notre
  installateur) ; macOS et Linux : `setAsDefaultProtocolClient` (le système confirme sous macOS).
- Interface : ligne « Navigateur par défaut » (Paramètres, Comportement, `DefaultBrowserRow`) et carte unique sur
  la page d'accueil (`DefaultBrowserPrompt`), effacée par l'une ou l'autre réponse
  (`behavior.defaultBrowserPromptDismissed`), jamais en fenêtre privée ni quand l'état est « indisponible ».
- Réception (`src/main/default-browser/launch.ts`) : ligne de commande du premier lancement et de
  `second-instance` (verrou d'instance unique), `open-url`/`open-file` de macOS (écoutés avant `ready`).
  `launchUrl` n'accepte qu'une page web selon **`isPageOpenableUrl`** (la règle des liens ouverts par une page) ou
  un **fichier existant d'un type associé** (converti en `file://`) ; tout le reste (`javascript:`, `data:`,
  `browser://`, autres schémas, dossiers, autres fichiers) est ignoré, 20 au plus par lancement. `LaunchRouter`
  met en attente jusqu'à la création des fenêtres puis ouvre dans **la dernière fenêtre normale ayant eu le
  focus** (`WindowRegistry.lastFocused`), une nouvelle fenêtre si seules des fenêtres privées sont ouvertes ;
  l'onglet de page d'accueil vide est réutilisé.
- `file://` : `normalizeInput` continue de chercher un `file:` tapé, et les pages ne peuvent toujours pas y
  naviguer. Seul main charge un `file://` (`TabManager.navigate(…, { localFile: true })`) ; une page locale peut
  suivre un lien vers un autre fichier local (`will-navigate`), jamais une page web.

**Lecteur PDF.** `plugins: true` dans les `webPreferences` des onglets : le seul « plugin » d'Electron est le
lecteur PDF de Chromium, une extension interne (`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai`) dans un
cadre hors processus, bac à sable conservé (`sandbox`, `contextIsolation` inchangés), pour `http(s)` comme pour
`file://`. Une réponse `Content-Disposition: attachment` reste un téléchargement (ADR-013). L'aperçu des liens
(ADR-027) garde `plugins` désactivé : un PDF y est proposé au téléchargement, comme avant. Le mode lecture ne
trouve pas d'article dans un PDF et le dit ; les captures (ADR-031) prennent l'image composée, PDF compris.

**Historique (`browser://history`).** Page interne (ADR-012) `HistoryPage.svelte` : entrées groupées par jour
(`groupByDay`), recherche (tous les mots, accents ignorés), pages de 100 servies par main (`History.page`, curseur
`{lastVisit, url}` : ordre total, ni saut ni doublon), défilement infini, suppression d'une page ou d'une
sélection (`history:remove`), « Effacer l'historique » sur une période (`clearRangeStart` : dernière heure, depuis
minuit local, 7 jours, tout ; `history:clear-range`). Commande `open-history` (`Ctrl+H`, `⌘Y` sous macOS où
`⌘H` masque l'application), menu « … » (Tout l'historique), ligne « Tout l'historique » à la fin de `@h` dans la
barre universelle. Les trois canaux sont refusés aux fenêtres privées (`privateRefused`) et la page y affiche un
état vide : l'historique n'y est ni écrit (ADR-014) ni montré.

**Import (`browser://import`).**
- Parseurs purs `src/shared/import/` : `Bookmarks` et `Local State`/`Preferences` des navigateurs Chromium
  (temps en µs depuis 1601, convertis en `BigInt` car au-delà de `Number.MAX_SAFE_INTEGER`), `profiles.ini` de
  Firefox, `StorableSidebar.json` d'Arc (espaces, dossiers, onglets épinglés, favoris), CSV de mots de passe.
  Seules les adresses `http(s)` sont reprises (pas de bookmarklets ni de `file:`).
- Main `src/main/import/` : `browserLocations` (dossiers par OS : Chrome, Edge, Brave, Vivaldi, Opera, Chromium,
  Firefox, Arc), `detectSources` (profils par `Local State`/`profiles.ini`, sans lire les données), lecteurs par
  famille, `ImportService` (dans `AppServices`). SQLite (`History`, `places.sqlite`) lu par **`node:sqlite`**,
  intégré au Node 24 d'Electron 44 (aucun module natif à compiler), sur une **copie** du fichier et de son WAL :
  l'autre navigateur peut être ouvert et verrouiller sa base. 10 000 visites au plus (la limite de l'historique).
- Sans doublons : un favori dont l'URL existe est ignoré, les dossiers (aplatis en « Barre de favoris / Tech »)
  sont réutilisés par nom ; une page d'historique connue garde son titre et prend la visite la plus récente et le
  plus grand nombre de visites (`History.importEntries`) ; le moteur de recherche n'est repris que s'il fait partie
  des nôtres (même site). Arc : onglets épinglés → favoris rangés sous « Arc / espace / dossier », favoris de la
  barre → grille des favoris (rien n'est ouvert : certains ont des centaines d'onglets épinglés).
- **Mots de passe : CSV seulement.** Chromium chiffre les siens avec une clé du système (DPAPI sous Windows,
  trousseau sous macOS, Secret Service sous Linux) et Firefox avec son propre coffre (`key4.db`, éventuellement
  protégé par un mot de passe principal). Les déchiffrer demanderait de lire les secrets d'une autre application,
  ce qu'un navigateur ne doit pas faire ni encourager. Chacun exporte un CSV ; `parsePasswordCsv` lit les formats
  Chrome/Edge/Brave/Opera, Firefox, Safari, Bitwarden et le nôtre (cellules désamorcées). Le fichier est choisi
  dans une boîte de dialogue de main (l'interface ne donne jamais de chemin), 8 Mo au plus ; même compte (origine +
  identifiant) et même mot de passe : ignoré, mot de passe différent : mis à jour.
- Safari : non importé (`Bookmarks.plist` binaire, accès disque complet requis sous macOS récents).
- Jamais depuis une fenêtre privée (canaux `import:*` en `privateRefused`, page en état vide).
- Tests : crochet `BROWSER_TEST_IMPORT_DIR` (un dossier « User Data » Chromium ajouté aux sources, ignoré une fois
  empaqueté, ADR-018) ; profils de test construits par `tests/fixtures/import/profiles.ts`.

**Conséquences.** Les PDF ne sont plus téléchargés quand le site les affiche ; un fichier local s'ouvre en
`file://` (pages locales liées entre elles, mais toujours inaccessibles depuis le web). L'import d'historique est
plafonné à 10 000 pages ; les mots de passe demandent un détour par un fichier à supprimer ensuite.

## ADR-040 — Contenus protégés (Widevine), connexion Google, signature Windows

**Contexte.** Trois obstacles empêchaient d'en faire le navigateur de tous les jours : Netflix, Disney+, Prime
Video et Spotify exigent un module DRM (Widevine) qu'Electron standard n'embarque pas ; Google refuse la
connexion aux « navigateurs intégrés » qu'il reconnaît ; Windows SmartScreen avertit à chaque installation
d'un exécutable non signé.

**Décision — Widevine.**
- Dépendance `electron` = **castLabs Electron for Content Security** (`github:castlabs/electron-releases#v44.9.3+wvcus`,
  même Chromium que la 44.9.3 standard). Son `install.js` télécharge le binaire depuis les releases castLabs :
  `scripts/ensure-electron.mjs` n'a pas changé. electron-builder télécharge les binaires des autres
  plateformes/architectures depuis le même endroit (`build.electronDownload.mirror`). Le lockfile référence
  un commit (`git+ssh` réécrit en https par npm : `npm ci` marche sans clé SSH).
- `src/main/drm.ts` : `castlabsComponents()` lit l'API `components` par l'espace de noms `electron` (absente
  avec Electron standard : l'interrupteur est la seule ligne de `package.json`) ; `WidevineService` (dans
  `AppServices`) attend `components.whenReady([WIDEVINE_CDM_ID])` **avant de créer les fenêtres** (une page
  créée avant l'enregistrement du CDM ne peut pas l'utiliser), mais jamais plus de `WIDEVINE_WAIT_MS` (6 s) :
  hors ligne ou en échec, le navigateur démarre sans DRM. `--disable-component-update` (tests e2e) : ni
  téléchargement ni attente. Linux : le service de composants répond « Unsupported component » (constaté
  sur 44.9.3+wvcus) : refus immédiat, aucun délai, « Widevine indisponible ».
- Permission `mediaKeySystem` : sans invite, décidée par le réglage `privacy.protectedContent` (vrai par
  défaut, aussi en fenêtre privée : rien n'est écrit dans le profil par le CDM hors de son dossier de
  composants). Désactivé : la page se voit refuser Widevine et le démarrage n'attend plus le CDM.
- Paramètres → Confidentialité, ligne « Contenus protégés (DRM) » (`DrmRow`, ancre `drm`, canal `drm:status`) :
  version du CDM, « installation en cours », « actif au prochain démarrage » (Linux, premier
  téléchargement), « Widevine indisponible » ou « Désactivé » (modèle pur `src/shared/drm.ts`).
- **Signature VMP** (castLabs EVS, gratuite) : exigée en production sous Windows et macOS. Crochets
  electron-builder `scripts/vmp-after-pack.cjs` / `vmp-after-sign.cjs` (`scripts/vmp-sign.cjs`), actifs
  seulement avec `EVS_ACCOUNT_NAME`/`EVS_PASSWD` : macOS en `afterPack` **après les fusibles** (le crochet
  les applique lui-même ; electron-builder les réapplique aux mêmes valeurs, octets inchangés) et avant la
  signature Apple ; Windows en `afterSign` (après Authenticode), ou en `afterPack` sans signature de code.

**Décision — connexion Google.** `navigator.userAgent` et l'en-tête `User-Agent` sont déjà ceux de Chrome
réduit (ADR-014). Les en-têtes `Sec-CH-UA` et `Sec-CH-UA-Full-Version-List` sont désormais **remplacés** par la
liste de marques exacte de Google Chrome de la même version (`chromeBrands` : algorithme
`GenerateBrandVersionList` de Chromium, marque GREASE et ordre dérivés du numéro majeur ; testé sur les
valeurs réelles de Chrome 120 et 131), pour toutes les requêtes des sessions d'onglets, travailleurs
compris. Les pages n'ont aucun global Electron/Node (pas de preload, ADR-003) : vérifié par e2e.
Limite connue : `navigator.userAgentData.brands` reste celui de Chromium (« Chromium » + GREASE) ; le
changer exigerait `Emulation.setUserAgentOverride` par le protocole DevTools, débogueur attaché en
permanence à chaque onglet (et aux cadres hors processus), écarté. La connexion réelle se vérifie à la
main à chaque montée d'Electron (docs/INSTALL.md).

**Décision — signature Windows.** Prête à activer, sans effet tant que les secrets manquent : Azure
Trusted Signing (prioritaire) par `win.azureSignOptions` (endpoint, compte, profil, `publisherName`),
écrit par le workflow de release (`npm pkg set`) seulement si les secrets `AZURE_*` existent ; sinon
certificat classique `WIN_CSC_LINK`. `publisherName` n'est jamais mis dans `package.json` : présent
dans `app-update.yml` d'une version non signée, il ferait refuser toutes les mises à jour.

**Conséquences.** Le binaire Electron vient de castLabs (mises à jour de sécurité au rythme de leurs
publications, à suivre à chaque montée de version : choisir le tag `v<version>+wvcus` correspondant).
Premier lancement sous Windows/macOS : jusqu'à 6 s d'attente le temps de télécharger le CDM. Sans
secrets EVS, Widevine est présent mais les grands services refusent (ou limitent) la lecture.

## ADR-041 — Adresses et cartes, clés d'accès, notifications, orthographe

**Contexte.** Il manquait au navigateur ce qu'un navigateur principal offre dans les formulaires et autour :
remplissage des adresses et cartes, clés d'accès (WebAuthn), notifications des sites, choix des
dictionnaires. Contraintes : pas de preload pour les pages (ADR-003), rien d'écrit en fenêtre privée
(ADR-014), le serveur de synchronisation ne voit jamais de clair (ADR-019).

**Décision — adresses et cartes.** Modèle pur `src/shared/autofill/` partagé bureau/téléphone :
- *Classement des champs* (`classifyField`/`classifyForm`) : jetons `autocomplete` d'abord (sections,
  `shipping`/`billing` ignorés), puis mots fr/en du nom, id, libellé, texte indicatif et `aria-label`
  (accents retirés), avec le contexte du formulaire (« Nom » seul = nom complet, « nom » dans un formulaire
  de carte = titulaire, deuxième rue = ligne 2). Les champs de connexion, recherche, codes promo, IBAN… sont
  écartés. Testé sur des formulaires types (français sans attributs, américain avec, cartes).
- *Cartes* : Luhn, marques par préfixes IIN et longueurs, expiration « MM/AA », mois/année séparés ou listes.
  Le **code de sécurité n'est jamais enregistré** : classé `cc-csc` pour n'être ni lu ni rempli, le script de
  page ne transmet même pas la valeur d'un champ dont le nom l'évoque.
- *Bureau* : un seul document chiffré par `safeStorage` (`autofill.json`, `EncryptedStore`, même règles que le
  coffre des mots de passe : rien sans trousseau, fichier indéchiffrable jamais écrasé). Le script de veille
  (monde isolé 1014) ne fait que **décrire** les champs (et leurs valeurs à l'envoi) ; main classe, propose
  « Enregistrer cette adresse/carte ? » (overlay `autofill-save`), et à la première entrée dans un champ
  reconnu d'un formulaire (ou flèche bas) ouvre la liste `autofill-fill` sous le champ ; le remplissage
  (monde isolé 1015) pose les valeurs par indice, si l'origine n'a pas changé. Aussi « Remplir une adresse /
  une carte » du menu de la page. Le numéro d'une carte n'atteint l'interface que par `autofill:reveal-card`,
  après une demande de main lui-même (Touch ID sur Mac, sinon une boîte de dialogue native : Electron n'expose
  pas Windows Hello aux applications). Jamais en fenêtre privée : la veille n'y est pas branchée (`pageReady`)
  et chaque canal le revérifie.
- *Téléphone* : même modèle dans `expo-secure-store` (morceaux `autofill.*`) ; remplissage seulement au
  toucher (menu de la page) : script de description avec un nonce par demande, réponse validée (nonce,
  origine du message et de l'onglet), plan calculé par l'application, valeurs injectées par indice.
- *Synchronisation* : collection `addresses` facultative (`autofill.syncAddresses`, désactivée par défaut,
  chiffrée de bout en bout) ; les cartes ne sont jamais synchronisées.

**Décision — clés d'accès (vérifié sur l'API d'Electron 44).** WebAuthn n'est pas une permission des
gestionnaires de session d'Electron (`publickey-credentials-get/create` n'y apparaissent pas : la
Permissions-Policy des cadres est appliquée par Chromium) ; un test unitaire vérifie que la politique ne les
traite pas, et que HID/série/USB restent refusés. Ce qui marche : **Windows** délègue tout à webauthn.dll
(Windows Hello, clés USB/NFC avec PIN, téléphone par QR code). **macOS** : clés USB par la pile HID de
Chromium, sans dialogue de PIN (une clé qui en exige échoue) ; Touch ID seulement via
`app.configureWebAuthn` avec un groupe d'accès au trousseau présent dans les droits de l'application signée
(`touchIdKeychainGroup`, `null` tant que les versions ne sont pas signées avec ce droit) ; ni trousseau
iCloud ni téléphone. **Linux** : clés USB (accès hidraw par udev), sans PIN, pas d'authentificateur intégré.
`PasskeyService` (`SessionService`) répond à `select-webauthn-account` (plusieurs comptes) par un choix natif ;
sans réponse, la demande échouerait. Non vérifié sur matériel dans la CI.

**Décision — notifications.** Permission par la barre d'autorisation existante (décisions par site, en
mémoire en fenêtre privée), modifiable dans Infos sur le site (Autoriser/Bloquer/Réinitialiser). Electron
n'offre aucun crochet sur les notifications des pages : un petit shim en monde principal remplace le
constructeur `Notification` (gardant `permission`/`requestPermission`) et passe la demande, par un événement
DOM au nom aléatoire par document, au relais en monde isolé 1016 ; main revérifie la permission de
l'origine, applique « Ne pas déranger » et une limite (5 / 10 s par site), puis affiche une notification
native titrée « site — titre » avec le favicon de l'onglet ; un clic ramène fenêtre et onglet, puis la page
reçoit `click`. Une page peut tromper son propre shim, sans plus de pouvoir qu'avec la vraie API. **Non pris
en charge** : `registration.showNotification` et Web Push (service workers, réception site fermé) ; Electron
n'implémente pas le service push. Crochet e2e `BROWSER_TEST_NOTIFICATIONS` (application non empaquetée).

**Décision — orthographe.** `settings.spellcheck` (activé, langues ≤ 8). `SpellcheckService` (`SessionService`)
applique `setSpellCheckerEnabled`/`setSpellCheckerLanguages` à chaque session d'onglets et suit les réglages ;
sans choix, le dictionnaire de la langue de l'application. macOS utilise le correcteur du système (langues
non réglables). Les mots ajoutés vont dans toutes les sessions du profil (espaces isolés compris) ; depuis
une fenêtre privée, dans sa seule session. Chromium télécharge les dictionnaires choisis au premier usage.

**Conséquences.** Les heuristiques de champs se trompent parfois sur des formulaires inhabituels : rien n'est
rempli sans un choix explicite, et seules les étiquettes reconnues sont remplies. Les mondes isolés 1014 à
1016 sont réservés.

## ADR-042 — Reprise après plantage, profils, gestionnaire de tâches, impression, sauvegarde

**Contexte.** Un navigateur de tous les jours doit survivre à ses propres plantages et à ceux des pages, séparer
plusieurs usages (travail, personnel), montrer ce qui consomme, imprimer proprement et se sauvegarder.

**Décision.**
- **Session et plantage.** La session (fenêtres, espaces, onglets, dossiers, vue scindée) était déjà écrite de façon
  atomique et différée (`JsonFile`, 1 s). Un marqueur `running.marker` est écrit à l'ouverture du profil et effacé à
  `will-quit`, après l'écriture des fichiers ; le trouver au démarrage signale une fermeture anormale. `startupPlan`
  (pur) : après un plantage **rien ne se rouvre seul** (une page peut en être la cause), la carte « Restaurer la
  session ? » de la page d'accueil (`BrowserState.recovery`, jamais en privé) propose tout restaurer, choisir les
  fenêtres ou ignorer ; sinon le réglage « Au démarrage : reprendre où j'en étais / page d'accueil »
  (`behavior.restoreSession`) décide. Positions de défilement non conservées (pas de moyen fiable sans script dans
  la page). La fenêtre vide qui demande la restauration se ferme.
- **Récemment fermés.** Les onglets fermés gardent leur titre (`TabStore.closedTabs`, par espace) ; les fenêtres
  normales fermées parmi d'autres sont mémorisées (10, en mémoire seulement) : commande « Rouvrir la fenêtre fermée »
  (`CmdOrCtrl+Alt+Shift+T`, `Ctrl+Maj+N` étant la fenêtre privée), entrées dans le sous-menu Historique du menu « … ».
- **Page plantée.** `render-process-gone` (hors `clean-exit`) donne à l'onglet un `loadError` `PAGE_CRASHED` :
  `LoadErrorPage` affiche « Cette page a planté » ; « Actualiser » recharge l'adresse (`loadURL` crée un renderer).
- **Profils.** `profiles.json` à la racine des données ; « Personnel » (`default`) garde la racine elle-même :
  **aucune donnée ne bouge** à la mise à jour. Les autres profils vivent dans `Profiles/<id>/` (réglages, historique,
  favoris, mots de passe, sessions, synchronisation, partitions Chromium). L'état du processus principal (profil,
  services, espaces) étant global, **chaque profil ouvert est une instance** de l'application lancée avec
  `--profile=<id>` (`userData` changé avant le verrou d'instance unique, qui est par dossier) : l'isolement est
  complet par construction, au prix d'un processus principal par profil (écart assumé à « un seul processus »).
  Choix au démarrage : le dernier utilisé, ou `browser://profiles` en premier onglet si « Choisir le profil au
  démarrage » et plusieurs profils. Suppression : jamais « Personnel » ni le profil ouvert, confirmation, dossier effacé.
- **Gestionnaire de tâches** (`browser://tasks`, `Maj+Échap` : Échap avec Maj n'écrit rien, autorisé par
  `needsModifier`). `app.getAppMetrics()` relié aux `webContents.getOSProcessId()` des onglets, de l'interface et des
  pages d'arrière-plan d'extensions (`buildTaskRows`, pur) ; titres masqués pour les fenêtres privées ; mesure à la
  demande toutes les 2 s tant que la page est affichée. « Terminer le processus » : seulement un renderer d'onglet
  (`forcefullyCrashRenderer`), jamais le navigateur, le GPU ou l'interface.
- **Impression.** « Imprimer… » (`Ctrl+P`) : `printToPDF` dans un fichier temporaire affiché par le lecteur PDF de
  Chromium dans une `WebContentsView` (session en mémoire `print-preview`, bac à sable, aucune navigation) placée
  au-dessus du calque overlay comme l'aperçu des liens ; l'overlay `print-preview` dessine les options (pages,
  orientation, marges, échelle, arrière-plans, copies, destination). « Enregistrer en PDF » : boîte de dialogue de
  main ; imprimante : `webContents.print` (`printerOptions`). Le temporaire est effacé à la fermeture.
- **Sauvegarde** (`.browserbackup`, `src/shared/backup.ts`) : JSON des réglages, favoris, grille, historique,
  session, boosts, notes et archive (la page d'accueil est dans les réglages) ; **jamais de cookies ni de données
  de sites**. Mots de passe seulement si coché, scellés par une phrase secrète (scrypt N=2^15 + XChaCha20-Poly1305,
  `@noble`), vérifiée avant toute modification. Import : fichier choisi par main (64 Mo au plus), résumé, puis
  « Fusionner » (ajoute ce qui manque, garde les réglages) ou « Remplacer » ; chaque section repasse par le
  validateur de son fichier ; la session importée est proposée par la carte de restauration. Refusé en privé.

**Conséquences.** Tests : unitaires (plan de démarrage, marqueur, service de reprise, profils et chemins, relevé
des processus, options d'impression, codec et mauvaise phrase secrète), e2e `tests/e2e/lifecycle.spec.ts`
(processus tué puis carte, profil isolé, tâche terminée puis page plantée, PDF écrit, aller-retour de sauvegarde).
Crochets non empaquetés : `BROWSER_TEST_PRINT_PDF`, `BROWSER_TEST_BACKUP_EXPORT`, `BROWSER_TEST_BACKUP_IMPORT`.
