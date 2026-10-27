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
  charge aucune image distante, ADR-017). Servie depuis `app://browser/` (schéma privilégié, ADR-017),
  plus depuis `file://`.
- Pages web : `WebContentsView` sandboxées, sans preload, `webSecurity` actif, pas de `<webview>`.
- Les pages ne peuvent charger que `http(s)`, `about:` et `data:` ; `file:` / `javascript:` / `app:` sont refusés.
  Une page ne peut **ouvrir** (`window.open`, `target=_blank`) que `http(s)` et `about:blank`
  (`isPageOpenableUrl`), et seulement juste après un geste de l'utilisateur (bloqueur de fenêtres, ADR-017).
- Les permissions sensibles (caméra, micro, géoloc, notifications…) sont demandées site par site via une
  barre d'autorisation dans l'interface (décisions mémorisables par couple origine demandeuse / origine
  de premier niveau, ADR-017) ; seules les origines https
  (ou localhost) peuvent les demander. Le reste est refusé (voir ADR-008).
- Chaque message IPC est validé et n'est accepté que s'il provient d'une fenêtre du navigateur.

## ADR-004 — Moteur de recherche par défaut

DuckDuckGo par défaut (cohérent avec « privé ») ; Brave Search, Startpage et Google proposés.

## ADR-005 — Persistance en fichiers JSON

**Décision.** Session, historique et favoris sont des fichiers JSON dans le dossier de profil
(`userData`, ou `BROWSER_PROFILE_DIR` hors paquet — `--user-data-dir` sinon, ADR-017) : `session.json`,
`history.json`, `bookmarks.json`. Les favicons n'y sont que des `data:` d'au plus 16 Ko (ADR-017) ; une
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
  (ignoré par l'application empaquetée, ADR-017).

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
  autorisé dans un site ne l'est pas ailleurs, et la barre affiche « X (intégré dans Y) » (ADR-017).
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
  `.ps1`, `.jar`, `.app`, `.dmg`, `.pkg`, `.deb`, `.sh`, `.AppImage`…, et depuis ADR-017 les listes
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
  bureautiques sans macros ; ni archives, ni HTML/SVG, ni macros, ni images disque — ADR-017), revérifié
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
- Crochet de test : `BROWSER_TEST_SLEEP_MS` remplace le délai (sauf « Jamais » ; ignoré une fois empaqueté, ADR-017).

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
  reçoivent, ADR-017) mais `DownloadList.toJSON` l'exclut de `downloads.json` ;
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
  filtrée, et ignore les crochets de test. Les fusibles coupant l'inspecteur Node (ADR-017), le pilote
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
  (`decideOpenWindow`, ADR-017). Navigation limitée à `http(s)`, `about:`, `data:` (`isNavigableUrl`
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

## ADR-017 — Durcissement post-audit

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
