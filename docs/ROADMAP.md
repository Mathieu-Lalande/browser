# Roadmap

## Sprint 0 — Fondations ✅
Migration Tauri → Electron + Svelte 5, onglets réels (`WebContentsView`), barre latérale verticale,
barre d'adresse, page d'accueil, raccourcis, durcissement sécurité, tests unitaires + e2e.

## Sprint 1 — Le cœur d'un vrai navigateur
- ✅ Persistance : session (onglets restaurés à la demande), historique, favoris, suggestions
  dans la barre d'adresse, sites fréquents sur la page d'accueil. Reste : paramètres.
- Command palette (Ctrl+K) façon Arc : onglets ouverts, historique, favoris, actions.
- Bloqueur de pubs & traqueurs intégré, mode HTTPS uniquement, compteur et désactivation par site ✅
- Invite de permissions (caméra, micro, notifications…) par site ✅

## Sprint 2 — Personnalisation poussée
- Thèmes : couleur d'accent, dégradés, mode clair/sombre/auto, densité, coins, police.
- Espaces (workspaces) avec sessions isolées et thème propre.
- Split view (2 à 4 pages côte à côte), mode compact/zen.
- Raccourcis clavier configurables, CSS par site (« boosts »).

## Sprint 3 — Confort & vitesse
- Téléchargements, recherche dans la page, zoom par site, picture-in-picture.
- Mise en veille des onglets inactifs (mémoire), préchargement intelligent.
- Navigation privée (session éphémère), anti-fingerprinting.
- Packaging & mises à jour automatiques (electron-builder).
