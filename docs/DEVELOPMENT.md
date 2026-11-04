# Développement

## Architecture

Browser utilise Electron 44, Svelte 5, TypeScript, Vite, Vitest et Playwright. Le process principal
compose les services dans `src/main/services.ts`; l'interface est rendue par Svelte et les pages web
sont des `WebContentsView` sans preload ni accès Node. Le contrat IPC unique est défini dans
`src/shared/ipc.ts`, exposé par `src/preload/index.ts` et validé par le registre IPC.

Le code partageable bureau/mobile reste dans `src/shared` et ne dépend ni d'Electron, ni de Node, ni du DOM.
Les services par session implémentent `SessionService` et sont installés par `SessionHardener`.
Les décisions de sécurité et les limites connues sont consignées dans [`DECISIONS.md`](DECISIONS.md).

## Conventions

- Code, identifiants et commentaires en anglais ; texte d'interface en français.
- Icônes Lucide uniquement, via les composants `Icon`.
- Réutiliser les primitives `src/renderer/src/components/ui/` et les jetons de `global.css`.
- Toute nouvelle fonctionnalité IPC doit mettre à jour le contrat partagé, le preload, les validateurs
  et les gestionnaires main.
- Toute fonctionnalité qui écrit dans le profil doit respecter les fenêtres privées.

## Vérifications

```powershell
npm run typecheck
npm test
npm run build
npm run check:cycles
npx playwright test
```

Sous Linux sans affichage, utiliser `xvfb-run -a npx playwright test`. Pour le serveur de synchronisation :
`npm --prefix server test`. Pour le mobile, voir [`../mobile/README.md`](../mobile/README.md).
