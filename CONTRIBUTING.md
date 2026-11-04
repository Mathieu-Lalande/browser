# Contribuer

## Préparer une modification

Lisez [`CLAUDE.md`](CLAUDE.md), [`docs/DECISIONS.md`](docs/DECISIONS.md) et
[`docs/INSTALL.md`](docs/INSTALL.md). Créez une branche dédiée, conservez les changements ciblés et
n'ajoutez aucun secret ou fichier généré.

## Style

Respectez les conventions du projet : interface française, code anglais, icônes Lucide, primitives
`ui/`, jetons de `global.css`, sécurité IPC validée et compatibilité avec les fenêtres privées.

## Vérifier et proposer

```powershell
npm run typecheck
npm test
npm run build
npm run check:cycles
npx playwright test
```

Décrivez dans la demande de fusion le comportement changé, les tests exécutés et les limites Windows,
Linux ou macOS restantes. Les commits doivent être courts et explicites ; ne poussez jamais de secrets.
