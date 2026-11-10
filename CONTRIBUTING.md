# Contribuer

Browser est un logiciel propriétaire (voir [`LICENSE`](LICENSE)) : une contribution est relue puis intégrée
par le mainteneur.

## Préparer une modification

Lisez [`CLAUDE.md`](CLAUDE.md), [`docs/DECISIONS.md`](docs/DECISIONS.md) et
[`docs/INSTALL.md`](docs/INSTALL.md). Créez une branche dédiée, conservez les changements ciblés et
n'ajoutez aucun secret ni fichier généré (`out/`, `release/`, listes du bloqueur mobile…).

## Style

Respectez les conventions du projet : code, identifiants et commentaires en anglais ; texte d'interface
ajouté dans les deux catalogues `src/shared/i18n/fr.ts` (source) et `en.ts` (ADR-052) ; icônes Lucide,
primitives `ui/`, jetons de `global.css` ; IPC déclaré dans `src/shared/ipc.ts` avec arguments validés ;
rien d'écrit sur le disque depuis une fenêtre privée ; `src/shared` reste pur (ni Electron, ni Node, ni DOM).

## Vérifier et proposer

```powershell
npm run typecheck
npm run check:cycles
npm run check:i18n
npm test
npm run build
npx playwright test          # Linux sans affichage : xvfb-run -a npx playwright test
```

Selon la partie touchée : `cd mobile && npx tsc --noEmit && npx jest && npx expo export --platform android`,
`npm run test:server`, `cd site && npm ci && npm run build`. Une interface modifiée mérite ses captures
régénérées (`docs/INSTALL.md`, « Captures d'écran »).

Décrivez dans la demande de fusion le comportement changé, les tests exécutés et les limites Windows,
Linux ou macOS restantes. Les commits doivent être courts et explicites ; ne poussez jamais de secrets.
