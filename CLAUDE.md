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
- `npm install` : `.npmrc` active `legacy-peer-deps` (contourne un bug npm avec vitest 4).
- Préférences : `src/shared/settings.ts` (modèle + validateur) et `src/shared/theme.ts` (palette → variables CSS),
  voir ADR-011. Pages internes `browser://…` dessinées par l'interface : ADR-012 (jamais accessibles aux pages web).
- Fenêtres privées (ADR-014) : tout ce qui écrit dans le profil vérifie `BrowserController.isPrivate`
  (par fenêtre) ou `isPrivateSession(session)` (`src/main/private.ts`, par session : téléchargements, zoom…).
- Mise en veille des onglets : un onglet déchargé = `view` null + URL (mécanisme unique de `TabManager`),
  politique pure dans `src/main/sleep.ts`. Packaging/CI : ADR-015 (`npm run dist:dir`, test `packaging`).
