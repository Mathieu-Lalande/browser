# Browser

Browser est un navigateur desktop rapide, prive et minimaliste, inspire de Zen, Brave et Arc.

## Sprint 1 — shell de navigation

Le premier vertical slice fournit une interface Tauri 2 avec :

- onglets creables et fermables ;
- barre d'adresse avec normalisation des URLs et recherche ;
- raccourcis `Ctrl+L`, `Ctrl+T` et `Ctrl+W` ;
- page d'accueil et etat de navigation prets pour l'integration du moteur web.

## Developpement

Prerequis : Node.js 20+ et Rust via [rustup](https://rustup.rs/).

```bash
npm install
npm run dev
```

Le moteur de rendu web, l'historique session-only et le blocage des traqueurs sont planifies pour les prochains sprints.
