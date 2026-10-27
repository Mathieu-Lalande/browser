# Browser

Un navigateur desktop **rapide, privé et entièrement personnalisable**, dans l'esprit d'Arc et de Zen.

- Moteur Chromium via Electron, un onglet = une `WebContentsView` sandboxée.
- Interface Svelte 5 : barre latérale verticale, onglets épinglés, barre d'adresse intégrée, page d'accueil.
- Espaces (onglets, emoji et couleur propres ; sessions isolées façon conteneurs en option) et vue scindée
  (2 à 4 pages côte à côte).
- Session restaurée au démarrage (onglets chargés à la demande), historique, favoris, suggestions
  dans la barre d'adresse et sites les plus visités sur la page d'accueil.
- Palette de commandes (`Ctrl/Cmd+K`) : onglets ouverts, favoris, historique et actions, recherche floue.
- Recherche privée par défaut (DuckDuckGo), protections de sécurité strictes (voir `docs/DECISIONS.md`).
- Boucliers intégrés : bloqueur de pubs & traqueurs (listes EasyList/uBlock via Ghostery), mode HTTPS uniquement,
  Global Privacy Control, invite de permissions par site, user agent et client hints sans trace d'Electron,
  `Accept-Language` uniformisable.
- Fenêtres privées (`Ctrl/Cmd+Maj+N`) : session en mémoire propre à la fenêtre, effacée à sa fermeture ;
  ni historique, ni session, ni autorisations mémorisées.
- Mise en veille des onglets inactifs (mémoire libérée, page rechargée au retour ; jamais pour un onglet
  qui joue du son ou un formulaire en cours).
- Paramètres (`browser://settings`) appliqués à chaud : thème clair/sombre/auto, couleur d'accent avec
  palette dérivée accessible, arrière-plans, densité, coins, police, barre latérale à gauche ou à droite
  (redimensionnable), page bord à bord, mode zen, moteur de recherche, page d'accueil personnalisée.
- Téléchargements sans boîte de dialogue (pause, reprise, annulation, historique, `browser://downloads`) ;
  les programmes et scripts attendent une confirmation et rien n'est jamais ouvert automatiquement.
- Recherche dans la page, zoom mémorisé par site, image dans l'image, son coupé onglet par onglet.

![Paramètres](docs/screenshots/settings.png)

![Fenêtre privée](docs/screenshots/private.png)
![Téléchargements](docs/screenshots/downloads.png)

![Recherche dans la page](docs/screenshots/find.png)

## Démarrer

Prérequis : Node.js 20+.

```bash
npm install
npm run dev        # lance le navigateur en mode développement (HMR sur l'interface)
```

## Version mobile (iOS et Android)

Le dossier [`mobile/`](mobile/README.md) contient l'application pour téléphone (Expo / React Native),
pensée pour une utilisation à une main : barre d'adresse en bas qui se replie au défilement,
balayage de la barre pour changer d'onglet, recherche plein écran, vue des onglets avec espaces,
navigation privée. Elle réutilise directement `src/shared` (URL, historique, recherche floue,
commandes, paramètres, thème, HTTPS uniquement) ; voir l'ADR-016.

Pour l'essayer sur votre téléphone (Windows, macOS ou Linux) : installez **Expo Go** depuis
l'App Store ou le Play Store, puis

```bash
cd mobile
npm install
npx expo start     # scannez le QR code ; même Wi-Fi, ou `npx expo start --tunnel`
```

| Accueil | Onglets | Recherche |
| --- | --- | --- |
| ![Accueil mobile](docs/screenshots/mobile-start-light.png) | ![Onglets mobile](docs/screenshots/mobile-tabs-dark.png) | ![Recherche mobile](docs/screenshots/mobile-search-light.png) |

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Développement |
| `npm run build` | Build de production dans `out/` |
| `npm run typecheck` | TypeScript (process principal) + svelte-check (interface) |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests end-to-end (Playwright pilotant Electron) |
| `npm run dist` | Paquets installables (electron-builder) dans `release/` |
| `npm run dist:dir` | Application empaquetée non compressée (plus rapide, pour tester) |

Sous Linux sans affichage (CI) : `xvfb-run -a npm run test:e2e`. Test de fumée du paquet :
`npm run dist:dir && BROWSER_PACKAGED=release/linux-unpacked/browser xvfb-run -a npx playwright test packaging`.
La CI GitHub Actions (`.github/workflows/ci.yml`) lance les vérifications à chaque push et construit des
paquets non signés pour Linux, Windows et macOS sur `master` (ADR-015).

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Palette de commandes (`Ctrl/Cmd+Entrée` : ouvrir dans un nouvel onglet) |
| `Ctrl/Cmd+L` | Barre d'adresse |
| `Ctrl/Cmd+T` / `W` | Nouvel onglet / fermer l'onglet |
| `Ctrl/Cmd+N` / `Ctrl/Cmd+Maj+N` | Nouvelle fenêtre / nouvelle fenêtre privée |
| `Ctrl/Cmd+Shift+K` | Dupliquer l'onglet (avec son historique) |
| `Ctrl/Cmd+Shift+C` | Copier l'URL de la page |
| `Ctrl/Cmd+=` / `-` / `0` | Zoom avant / arrière / zoom par défaut (mémorisé par site) |
| `Ctrl/Cmd+F` | Rechercher dans la page (`Entrée` / `Maj+Entrée`, `F3` / `Maj+F3` : suivante / précédente) |
| `Ctrl+Maj+J` (`⌥⌘L` sous macOS) | Téléchargements |
| `Ctrl+M` | Couper / réactiver le son de l'onglet |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl/Cmd+1…9` | Aller à l'onglet n |
| `Ctrl/Cmd+S` | Afficher/masquer la barre latérale |
| `Ctrl/Cmd+Maj+B` | Mode zen (barre latérale masquée, page bord à bord) |
| `Ctrl/Cmd+Alt+1…9`, `Ctrl/Cmd+Alt+←/→` | Aller à l'espace n / espace précédent, suivant |
| `Ctrl/Cmd+Maj+\` | Vue scindée (l'onglet actif et le suivant côte à côte) / la quitter |
| Clic droit sur un onglet | Épingler, dupliquer, vue scindée, déplacer vers un espace, mettre en veille, fermer… |
| Palette : « veille » | Mettre l'onglet / les autres onglets en veille |
| `Ctrl/Cmd+,` | Paramètres |
| `Ctrl/Cmd+D` | Ajouter/retirer la page des favoris |
| `Ctrl/Cmd+R`, `F5` | Actualiser |
| Double-clic sur un onglet | Épingler / désépingler |

## Structure

```
src/
  main/       process principal : fenêtres, onglets, sécurité, menus/raccourcis, IPC
    storage/  persistance JSON (session, historique, favoris, paramètres), logique pure et testée
  preload/    pont sécurisé exposant window.browser à l'interface
  renderer/   interface du navigateur (Svelte 5)
  shared/     logique pure partagée bureau + mobile : types, contrat IPC, URL et recherche,
              historique, HTTPS uniquement, paramètres, moteur de thème (testés)
mobile/       application iOS/Android (Expo / React Native), voir mobile/README.md
tests/e2e/    tests Playwright + Electron
docs/         décisions d'architecture et roadmap
```
