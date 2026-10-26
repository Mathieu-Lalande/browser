# Browser — notes pour les agents

- Stack : Electron 44 (process principal en TS), Svelte 5 runes (interface), electron-vite, Vitest, Playwright.
- Lire `docs/DECISIONS.md` (modèle de sécurité) avant de toucher `src/main/security.ts`, le preload ou l'IPC.
- Contrat IPC unique : `src/shared/ipc.ts` (`Channels` + `BrowserApi`). Tout nouveau canal : l'ajouter là,
  l'exposer dans `src/preload/index.ts`, le valider dans `src/main/ipc.ts` (arguments vérifiés, émetteur = fenêtre connue).
- Les pages web ne reçoivent jamais de preload ni d'accès Node.
- L'interface ne peut pas dessiner au-dessus des pages (`WebContentsView` est natif) : tout panneau
  doit soit réduire la zone `viewport`, soit masquer la vue active.
- Texte d'interface en français ; code, identifiants et commentaires en anglais.
- Vérifications avant commit : `npm run typecheck && npm test && npm run build && xvfb-run -a npx playwright test`
  (en root/conteneur, l'app est lancée avec `--no-sandbox`, déjà géré par les fixtures e2e).
- `npm install` : `.npmrc` active `legacy-peer-deps` (contourne un bug npm avec vitest 4).
- Préférences : `src/shared/settings.ts` (modèle + validateur) et `src/shared/theme.ts` (palette → variables CSS),
  voir ADR-006. Pages internes `browser://…` dessinées par l'interface : ADR-007 (jamais accessibles aux pages web).
