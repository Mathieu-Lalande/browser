# Browser — notes pour les agents

- Stack : Electron 44 (process principal en TS), Svelte 5 runes (interface), electron-vite, Vitest, Playwright.
- Lire `docs/DECISIONS.md` (modèle de sécurité) avant de toucher `src/main/security.ts`, le preload ou l'IPC.
- Contrat IPC unique : `src/shared/ipc.ts` (`Channels` + `BrowserApi`). Tout nouveau canal : l'ajouter là,
  l'exposer dans `src/preload/index.ts`, le valider dans `src/main/ipc.ts` (arguments vérifiés, émetteur = fenêtre connue).
- Les pages web ne reçoivent jamais de preload ni d'accès Node.
- L'interface (chrome) ne peut pas dessiner au-dessus des pages (`WebContentsView` est natif) : un panneau
  doit soit réduire la zone `viewport`, soit masquer la vue active, soit vivre dans le calque overlay
  (`src/main/overlay.ts`, entrée `src/renderer/overlay.html`) comme la palette de commandes (ADR-010).
- Actions du navigateur : registre unique `src/shared/commands.ts` (libellé, mots-clés, raccourci) exécuté
  par `src/main/commands.ts` ; le menu et la palette s'en servent tous les deux.
- Texte d'interface en français ; code, identifiants et commentaires en anglais.
- Vérifications avant commit : `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test`
  (en root/conteneur, l'app est lancée avec `--no-sandbox`, déjà géré par les fixtures e2e).
- `npm install` : `.npmrc` active `legacy-peer-deps` (contourne un bug npm avec vitest 4). Electron 44 ne télécharge
  plus son binaire à l'installation : `scripts/ensure-electron.mjs` le fait (`postinstall`, `predev`).
- Préférences : `src/shared/settings.ts` (modèle + validateur) et `src/shared/theme.ts` (palette → variables CSS),
  voir ADR-011. Pages internes `browser://…` dessinées par l'interface : ADR-012 (jamais accessibles aux pages web).
- Fenêtres privées (ADR-014) : tout ce qui écrit dans le profil vérifie `BrowserController.isPrivate`
  (par fenêtre) ou `isPrivateSession(session)` (`src/main/private.ts`, par session : téléchargements, zoom…).
- Mise en veille des onglets : un onglet déchargé = `view` null + URL (mécanisme unique de `TabManager`),
  politique pure dans `src/main/sleep.ts`. Packaging/CI : ADR-015 (`npm run dist:dir`, test `packaging`).
- Téléchargements, recherche dans la page, zoom par site, médias : ADR-013. `installDownloads(session)`
  (`src/main/downloads/`) est idempotente et doit être appliquée à chaque session d'onglets.
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
  (`src/main/page-menu*.ts`, `src/main/site-info/`). Toute URL venue d'une page repasse par `isPageOpenableUrl`.
- Releases et site vitrine (ADR-023) : workflow de release sur tag `v*` (`npm run release:version`), noms de
  fichiers fixés par `artifactName` (le site en dépend), page de fin NSIS dans `build/installer.nsh` ; site
  statique `site/` (Vite + TS : `cd site && npm ci && npm run build`), déployé sur GitHub Pages.
- Organisation (ADR-022) : dossiers d'onglets (`src/shared/folders.ts`, session v3), grille des favoris
  (`src/shared/favorites.ts`, `favorites.json`, collection de synchro `favorites`), geste à deux doigts entre
  espaces (`src/shared/space-swipe.ts`), archivage (`src/shared/archive.ts`, `browser://archive`) ; côté main :
  `src/main/organize.ts`. Le téléphone a sa version (`mobile/src/lib/organize.ts`, dossiers dans `tabs.ts`).
- Extensions (ADR-024) : `src/main/extensions/` (`installExtensions(session)` via `hardenSession`, idempotente),
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
