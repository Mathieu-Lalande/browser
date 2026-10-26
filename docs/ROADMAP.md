# Roadmap

## Sprint 0 — Fondations ✅
Migration Tauri → Electron + Svelte 5, onglets réels (`WebContentsView`), barre latérale verticale,
barre d'adresse, page d'accueil, raccourcis, durcissement sécurité, tests unitaires + e2e.

## Sprint 1 — Le cœur d'un vrai navigateur
- ✅ Persistance : session (onglets restaurés à la demande), historique, favoris, suggestions
  dans la barre d'adresse, sites fréquents sur la page d'accueil. Reste : paramètres.
- ✅ Palette de commandes (Ctrl+K) façon Arc : onglets ouverts, historique, favoris, actions,
  recherche floue ; calque flottant (« overlay ») au-dessus des pages, réutilisable pour menus et popovers.
- Bloqueur de pubs & traqueurs intégré, mode HTTPS uniquement, compteur et désactivation par site ✅
- Invite de permissions (caméra, micro, notifications…) par site ✅

## Sprint 2 — Personnalisation poussée
- ✅ Paramètres (`browser://settings`) appliqués à chaud : thème clair/sombre/auto, couleur d'accent
  et dégradé (palette dérivée, contraste WCAG AA), arrière-plan, densité, coins, police, ombres,
  animations réduites ; barre latérale à gauche/droite et redimensionnable, marge de page ;
  moteur de recherche ; page d'accueil (prénom, horloge, sites, fond) ; session, position des
  nouveaux onglets, onglet affiché après fermeture ; effacement de l'historique, gestion des favoris.
- ✅ Mode zen (Ctrl+Maj+B).
- Espaces (workspaces) avec sessions isolées et thème propre.
- Split view (2 à 4 pages côte à côte).
- Raccourcis clavier configurables, CSS par site (« boosts »).

## Sprint 3 — Confort & vitesse
- Téléchargements, recherche dans la page, zoom par site, picture-in-picture.
- Mise en veille des onglets inactifs (mémoire), préchargement intelligent.
- Navigation privée (session éphémère), anti-fingerprinting.
- Packaging & mises à jour automatiques (electron-builder).
