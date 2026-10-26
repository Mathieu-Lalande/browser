# Browser

Un navigateur desktop **rapide, privé et entièrement personnalisable**, dans l'esprit d'Arc et de Zen.

- Moteur Chromium via Electron, un onglet = une `WebContentsView` sandboxée.
- Interface Svelte 5 : barre latérale verticale, onglets épinglés, barre d'adresse intégrée, page d'accueil.
- Session restaurée au démarrage (onglets chargés à la demande), historique, favoris, suggestions
  dans la barre d'adresse et sites les plus visités sur la page d'accueil.
- Palette de commandes (`Ctrl/Cmd+K`) : onglets ouverts, favoris, historique et actions, recherche floue.
- Recherche privée par défaut (DuckDuckGo), protections de sécurité strictes (voir `docs/DECISIONS.md`).
- Boucliers intégrés : bloqueur de pubs & traqueurs (listes EasyList/uBlock via Ghostery), mode HTTPS uniquement,
  Global Privacy Control, invite de permissions par site.

## Démarrer

Prérequis : Node.js 20+.

```bash
npm install
npm run dev        # lance le navigateur en mode développement (HMR sur l'interface)
```

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Développement |
| `npm run build` | Build de production dans `out/` |
| `npm run typecheck` | TypeScript (process principal) + svelte-check (interface) |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests end-to-end (Playwright pilotant Electron) |
| `npm run dist` | Paquets installables (electron-builder) |

Sous Linux sans affichage (CI) : `xvfb-run -a npm run test:e2e`.

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Palette de commandes (`Ctrl/Cmd+Entrée` : ouvrir dans un nouvel onglet) |
| `Ctrl/Cmd+L` | Barre d'adresse |
| `Ctrl/Cmd+T` / `W` | Nouvel onglet / fermer l'onglet |
| `Ctrl/Cmd+Shift+K` | Dupliquer l'onglet (avec son historique) |
| `Ctrl/Cmd+Shift+C` | Copier l'URL de la page |
| `Ctrl/Cmd+=` / `-` / `0` | Zoom avant / arrière / taille réelle (page active) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl/Cmd+1…9` | Aller à l'onglet n |
| `Ctrl/Cmd+S` | Afficher/masquer la barre latérale |
| `Ctrl/Cmd+D` | Ajouter/retirer la page des favoris |
| `Ctrl/Cmd+R`, `F5` | Actualiser |
| Double-clic sur un onglet | Épingler / désépingler |

## Structure

```
src/
  main/       process principal : fenêtres, onglets, sécurité, menus/raccourcis, IPC
    storage/  persistance JSON (session, historique, favoris), logique pure et testée
  preload/    pont sécurisé exposant window.browser à l'interface
  renderer/   interface du navigateur (Svelte 5)
  shared/     types, contrat IPC, logique d'URL et de recherche (testées)
tests/e2e/    tests Playwright + Electron
docs/         décisions d'architecture et roadmap
```
