# Browser — notes pour les agents

- Stack : Electron 44 (process principal en TS), Svelte 5 runes (interface), electron-vite, Vitest, Playwright.
- Lire `docs/DECISIONS.md` (modèle de sécurité) avant de toucher `src/main/security.ts`, `src/main/session-hardener.ts`,
  le preload ou l'IPC.
- Services du process principal : conteneur `AppServices` (`src/main/services.ts`) construit une fois dans `src/main/index.ts`
  (chemins, profil, réglages, `BrowserController.directory` passés aux constructeurs) ; l'état vit dans les instances
  (`DownloadService`, `ExtensionService`, `PasswordVaultStore`, `ReaderService`, `StartImageCache`, `BoostService`,
  `CaptureService`, `SyncService`), les fonctions exportées des modules n'en sont que des façades (via `appServices()` de `src/main/app-services-ref.ts`, jamais `services.ts` : pas de cycle, `npm run check:cycles`). Un service ne
  dépend pas de `window.ts` : il reçoit les ports étroits de `src/main/ports.ts` (`WindowPort`, `TabPort`, `WindowDirectory`).
  Une fonctionnalité par session implémente `SessionService` (`install`/`release`) : `SessionHardener` les installe dans l'ordre
  à chaque `hardenSession` (jamais d'appel à la main). Fenêtres : registre `WindowRegistry` (`src/main/window-registry.ts`) ; `BrowserController` compose
  `src/main/window-parts/` (`WindowChrome` fenêtre native, `ChromeBridge` webContents de l'interface, `PageHooks` crochets par page).
- Contrat IPC unique : `src/shared/ipc.ts` (`Channels` + `BrowserApi`). Tout nouveau canal : l'ajouter là,
  l'exposer dans `src/preload/index.ts`, l'ajouter à la table de sa fonctionnalité dans `src/main/ipc/` (arguments vérifiés, émetteur = fenêtre connue).
- Registre IPC : `src/main/ipc/registry.ts` (validateurs typés `str`, `opt(…)`…, `on`/`handle`/`onUi`/`handleUi`,
  `defineHandlers`) ; `registerIpc` fusionne les tables et le compilateur exige un gestionnaire par canal de requête.
- Les pages web ne reçoivent jamais de preload ni d'accès Node.
- L'interface (chrome) ne peut pas dessiner au-dessus des pages (`WebContentsView` est natif) : un panneau
  doit soit réduire la zone `viewport`, soit masquer la vue active, soit vivre dans le calque overlay
  (`src/main/overlay.ts`, entrée `src/renderer/overlay.html`) comme la palette de commandes (ADR-010).
- Actions du navigateur : registre unique `src/shared/commands.ts` (libellé, mots-clés, raccourci) exécuté
  par `src/main/commands.ts` ; le menu et la palette s'en servent tous les deux.
- Primitives d'interface : `src/renderer/src/components/ui/` (`IconButton`, `Card`, `ListRow`, `Menu`/`MenuItem`, `Toggle`,
  `Row`, `Segmented`, `Checkbox`, `ConfirmButton`, `Button` (variante `quiet` des actions secondaires), `EmptyState`, `Page` (cadre des pages internes), `SearchField`,
  action `use:dismiss` (Échap / clic extérieur des menus et popovers, `ui/dismiss.ts`)) ;
  durées d'animation via `--motion-fast`/`--motion-base` (0 si mouvements réduits) ; échelles partagées dans `global.css`
  (`--space-1…6`, `--radius-sm/md/lg`, `--text-xs…xl`, `--hit-min`, champ `.ui-field`), jamais de valeurs propres à un composant ;
  mise en page partagée des panneaux découpés en sous-composants : `styles/kit.css` (`.kit-line`, `.kit-list`…, sous `.kit`).
- Composants du chrome : `Sidebar.svelte` ne fait que composer `components/sidebar/` (`SidebarHeader`, `NavButtons`,
  `SpaceHeader`, `SelectionBar`, `TabTree` (lignes + clavier), `SpacePeek`, `SidebarFooter`) ; glisser-déposer
  `lib/tree-drag.svelte.ts` (`TreeDrag`), balayage entre espaces `lib/space-swipe-controller.svelte.ts`, sélection
  `lib/tab-selection.svelte.ts` (Vitest compile les runes : contrôleurs testables). Réglages : une section par composant
  `settings/*Section.svelte`, `SettingsPage` = navigation, recherche et liste des sections (ancres `data-section`/`data-setting`).
- Texte d'interface en français ; code, identifiants et commentaires en anglais.
- Vérifications avant commit : `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test`
  (en root/conteneur, l'app est lancée avec `--no-sandbox`, déjà géré par les fixtures e2e).
- `npm install` : `.npmrc` active `legacy-peer-deps` (contourne un bug npm avec vitest 4). Electron 44 ne télécharge
  plus son binaire à l'installation : `scripts/ensure-electron.mjs` le fait (`postinstall`, `predev`).
- Préférences : `src/shared/settings.ts` (modèle + validateur) et `src/shared/theme.ts` (palette → variables CSS),
  voir ADR-011. Pages internes `browser://…` dessinées par l'interface : ADR-012 (jamais accessibles aux pages web).
- Fenêtres privées (ADR-014) : tout ce qui écrit dans le profil vérifie `BrowserController.isPrivate`
  (par fenêtre) ou `isPrivateSession(session)` (`src/main/private.ts`, par session : téléchargements, zoom…).
- Onglets : `src/main/tabs/` — façade `TabManager` (`manager.ts`) sur `TabStore`, `TabLayout`, `TabLifecycle`, `TabEvents`,
  `TabFolders`, `TabPageActions`. Mise en veille : un onglet déchargé = `view` null + URL (mécanisme unique de `TabLifecycle`),
  politique pure dans `src/main/sleep.ts`. Packaging/CI : ADR-015 (`npm run dist:dir`, test `packaging`).
- Téléchargements, recherche dans la page, zoom par site, médias : ADR-013. `DownloadService`
  (`src/main/downloads/service.ts`) est un `SessionService` idempotent, installé dans chaque session d'onglets par `hardenSession`.
- Application mobile : `mobile/` (Expo SDK 58 / React Native, ADR-016), importe `src/shared` via `@shared/*`
  (jamais de copie) : `src/shared` doit rester pur (ni Electron, ni Node, ni DOM). Vérifications dans `mobile/` :
  `npx tsc --noEmit && npx jest && npx expo export --platform android`.
- Icônes (ADR-017) : uniquement Lucide, via les composants `Icon` (bureau et mobile), importées une par une ;
  couleur via le thème/`currentColor`. Aucun emoji dans l'interface ; les icônes d'espace sont des noms Lucide
  de `SPACE_ICONS` (`src/shared/spaces.ts`), migrés depuis les anciens emojis par `migrateSpaceIcon`.
- Durcissement post-audit (ADR-018) : interface servie sur `app://browser/` (plus `file://`), favicons et image d'accueil
  récupérés par main puis passés en `data:` (CSP `img-src 'self' data:`), bloqueur de fenêtres surgissantes
  (`src/main/activation.ts`), fusibles Electron (`build.electronFuses`) ; crochets `BROWSER_*` ignorés une fois empaqueté.
- Synchronisation chiffrée (ADR-019) : moteur pur `src/shared/sync/` (crypto `@noble/*`, HLC, LWW), adaptateurs
  `src/main/sync/` et `mobile/src/lib/sync/`, relais `server/` (`cd server && npm test`). Le serveur ne doit
  jamais voir de clair ; rien de privé n'est synchronisé.
- Menu contextuel des pages, infos sur le site, données des sites, cookies tiers : ADR-021
  (`src/main/page-menu*.ts`, `src/main/site-info/` ; popover `overlay/SiteInfoPanel.svelte` + sections `overlay/site-info/`). Toute URL venue d'une page repasse par `isPageOpenableUrl`.
- Releases et site vitrine (ADR-023) : workflow de release sur tag `v*` (`npm run release:version`), noms de
  fichiers fixés par `artifactName` (le site en dépend), page de fin NSIS dans `build/installer.nsh` ; site
  statique `site/` (Vite + TS : `cd site && npm ci && npm run build`), déployé sur GitHub Pages.
- Organisation (ADR-022) : dossiers d'onglets (`src/shared/folders.ts`, session v3), grille des favoris
  (`src/shared/favorites.ts`, `favorites.json`, collection de synchro `favorites`), geste à deux doigts entre
  espaces (`src/shared/space-swipe.ts`), archivage (`src/shared/archive.ts`, `browser://archive`) ; côté main :
  `src/main/organize.ts`. Le téléphone a sa version (`mobile/src/lib/organize.ts`, dossiers dans `tabs.ts`).
- Mobile, organisation du code : données dans `mobile/src/state/stores/` (`TabsStore`, `HistoryStore`, `BookmarksStore`,
  `SettingsStore`… ; `useTabsStore`/`useHistoryStore`/`useBookmarksStore`/`useSettingsStore`), chargées et enregistrées
  via `lib/storage.ts` (`loadDocuments`, `persistDocument`) ; `BrowserProvider` garde l'API (`useBrowserState`/`Actions`).
  `BrowserScreen` compose des hooks de `mobile/src/hooks/` ; vue des onglets en parties (`components/overview/`).
- Extensions (ADR-024) : `src/main/extensions/` (`ExtensionService`, `SessionService` installé par `hardenSession`),
  `browser://extensions`, `extensions.json` ; l'interface vit dans sa propre session `src/main/ui-session.ts`.
- Mots de passe (ADR-025) : modèle `src/shared/passwords.ts`, main `src/main/passwords/` (coffre `safeStorage`,
  capture/remplissage par scripts en monde isolé, jamais de preload), `browser://passwords`, popovers overlay
  « password-save »/« password-fill » ; mobile `mobile/src/lib/passwords.ts` (`expo-secure-store`). Jamais d'invite
  en fenêtre privée ; un mot de passe ne traverse l'IPC que par `passwords:reveal`.
- Mode lecture et version mobile/ordinateur (ADR-026) : Readability en monde isolé (bureau) ou `injectJavaScript`
  (mobile), arbre JSON assaini par `sanitizeReaderArticle` (`src/shared/reader.ts`, jamais d'HTML injecté) ;
  `src/shared/readability-source.ts` est généré (`node scripts/gen-readability.mjs`).
- Aperçu des liens (ADR-027) : `src/main/peek.ts` (une `WebContentsView` durcie au-dessus du calque overlay, session de
  l'onglet source, rien d'enregistré), carte `LinkPeekPanel.svelte`, géométrie `src/shared/peek.ts` ; mobile `PeekSheet.tsx`.
- Raccourcis personnalisables (ADR-028) : `settings.shortcuts`, module pur `src/shared/accelerators.ts` ; tout raccourci
  affiché ou installé passe par `effectiveAccelerator`/`effectiveAliases` (jamais `command.accelerator` directement).
- Boosts par site (ADR-029) : modèle pur `src/shared/boosts.ts` (motifs d'hôte, sélecteurs validés, CSS généré),
  bureau `src/main/boosts/` (`insertCSS` à clés suivies, script et outil « Masquer des éléments » en monde isolé),
  `browser://boosts` (`components/boosts/` : `BoostsPage`, `BoostEditor`, `BoostRow`), collection de synchro `boosts` ; mobile `mobile/src/lib/boosts.ts` (pas d'outil de masquage).
- Mises à jour et thèmes partageables (ADR-030) : `src/shared/updates.ts` (état pur), `src/main/updates/`
  (`UpdateService` testable, adaptateur `electron-updater`, faux `BROWSER_TEST_UPDATER` en dev), `latest*.yml` publiés
  par le workflow de release ; codec `src/shared/theme-share.ts` (`browser-theme:v1:…`, `.browsertheme`, galerie),
  mobile `mobile/src/lib/themeShare.ts`.
- Options de la page, captures, vidéo, balayage tactile (ADR-031) : popover overlay `page-options`, `src/main/capture/` (`CaptureService`, `TabRecorder`)
  (capturePage, CDP `Page.captureScreenshot` via `webContents.debugger`, sélecteur en monde isolé 1009), enregistreur
  `MediaRecorder` dans l'interface (`lib/recorder.ts`) dont la seule source est l'onglet accordé par main ; helpers purs
  `src/shared/capture.ts`. Boutons de la barre d'adresse : masqués hors survol/focus (classe `act`, `keep` = état actif).
- Barre universelle (ADR-032) : moteur pur `src/shared/omnibox/` (fournisseurs `Provider`, score `scorer.ts`, filtres `@o @f @h @c @r`,
  réponses instantanées sans `eval`), overlay `src/renderer/src/overlay/omnibox/`, canaux `omnibox:*` ; liens profonds
  `browser://settings#section/ligne` (ancres `data-setting`, index `settings-index.ts`) ; mobile `buildSheet` sur le même moteur.
- Menus et gestes (ADR-033) : modèles purs `src/shared/menus.ts` (menu « … » overlay `app-menu` via `MenuList.svelte`,
  menus natifs barre latérale/espaces `src/main/context-menus.ts`), page `page-menu-model.ts` ; gestes de page
  `src/shared/page-gestures.ts` + guetteur en monde isolé `src/main/page-swipe-script.ts` ; collection de synchro `sent`.
- Nouvel onglet personnalisable (ADR-034) : modèle pur `src/shared/start-widgets.ts` (`settings.startPage.widgets`, catalogue,
  dispositions, notes/tâches jamais synchronisées), météo Open-Meteo `src/shared/weather.ts` demandée par main (`src/main/weather.ts`) ;
  bureau `src/renderer/src/components/start/` (`StartLayout`, mode édition), mobile `StartPage.tsx`/`StartWidgets.tsx`.
- Pause des médias (ADR-035) : modèle pur `src/shared/media.ts`, `MediaHub` par fenêtre (`src/main/media/`, sonde en monde isolé 1011,
  relevé seulement pendant la lecture, pochette en `data:`), canaux `media:*`, `MiniPlayer.svelte` (barre latérale), commande
  `pause-all-media` ; mobile `mobile/src/lib/media.ts` (nonce par document) + `MiniBar.tsx`.
- Traduction (ADR-036, désactivée par défaut) : cœur pur `src/shared/translate/` (services DeepL/LibreTranslate/Google,
  découpage, walker `TRANSLATE_WALKER`, règles), main `src/main/translate/` (HTTP par main, clés `safeStorage`, monde isolé
  1012, `PageTranslator` par fenêtre), popover overlay `translate`, commande `translate-page` ; mobile `mobile/src/lib/translate.ts`
  (nonce par demande, clés `expo-secure-store`). Fenêtre privée : confirmation à chaque fenêtre, règles en mémoire.
- Notes et surlignages (ADR-037) : modèle pur `src/shared/annotations/` (citation exacte + contexte, ancrage approché,
  export, collection de synchro `annotations` facultative via `CollectionAdapter.enabled`), annotateur `ANNOTATOR_FACTORY`
  (chaîne ES2018) en monde isolé 1013, `PageAnnotator` par fenêtre (`src/main/annotations/`, carnet en mémoire en fenêtre
  privée), popover overlay `annotation`, panneau `NotesPanel`, `browser://notes`, `@n` ; mobile `mobile/src/lib/annotations.ts`.
- Navigateur principal (ADR-039) : navigateur par défaut `src/main/default-browser/` (`DefaultBrowserService`, `LaunchRouter` :
  liens/fichiers du système → `launchUrl` (`isPageOpenableUrl` ou fichier associé existant) → dernière fenêtre normale ;
  `file://` seulement via `TabManager.navigate(…, { localFile })`), registre Windows dans `build/installer.nsh` ;
  lecteur PDF (`plugins: true`) ; `browser://history` (`History.page/removeMany/removeSince`, jamais en privé) ;
  import `src/shared/import/` (parseurs purs) + `src/main/import/` (`ImportService`, SQLite via `node:sqlite` sur une copie,
  crochet `BROWSER_TEST_IMPORT_DIR`), `browser://import`, mots de passe par CSV seulement.
- Aperçu des onglets au survol et thème dynamique (ADR-038) : purs `src/shared/tab-preview.ts` (`ThumbnailCache`, `HoverIntent`,
  géométrie) et `src/shared/site-color.ts` ; main `src/main/tab-preview.ts` (captures en mémoire, overlay passif `tab-preview`
  limité à la carte par `OverlayRequest.region`), action `use:tabPreview`, accent animé `lib/dynamic-accent.ts` via `accentVariables`.
