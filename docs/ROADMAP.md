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
- ✅ Espaces (workspaces) : onglets propres, emoji et couleur d'accent, sessions isolées optionnelles
  (conteneurs), déplacement d'onglets, Ctrl+Alt+1…9 (ADR-009).
- ✅ Vue scindée : 2 à 4 pages côte à côte, séparateurs déplaçables, Ctrl+Maj+\\ (ADR-009).
  Reste : glisser-déposer d'un onglet sur un volet pour l'ajouter.
- Raccourcis clavier configurables, CSS par site (« boosts »).

## Sprint 3 — Confort & vitesse
- ✅ Téléchargements (sans boîte de dialogue, noms uniques, pause/reprise/annulation, exécutables
  à confirmer, rien n'est ouvert automatiquement), popover dans l'overlay, `browser://downloads`,
  historique ; recherche dans la page (Ctrl+F, compteur, casse, requête gardée par onglet) ; zoom
  mémorisé par site et zoom par défaut ; image dans l'image ; indicateur de son et coupure par onglet.
  Reste : reprise des téléchargements interrompus après un redémarrage, vidéos dans des iframes
  pour l'image dans l'image.
- ✅ Mise en veille des onglets inactifs (délai réglable, jamais pour le son, les autorisations en
  attente ni les formulaires en cours ; onglets estompés ; commandes « Mettre en veille ») (ADR-014).
  Reste : préchargement intelligent, indicateur de mémoire libérée.
- ✅ Fenêtres privées (Ctrl/Cmd+Maj+N) : partition en mémoire par fenêtre, effacée à la fermeture,
  rien d'écrit sur le disque, thème privé (ADR-014).
- ✅ Anti-fingerprinting modeste : UA réduit, client hints cohérents, `Accept-Language` uniformisable.
  Hors périmètre (scripts injectés) : canvas, WebGL, polices (ADR-014).
- ✅ Packaging electron-builder (AppImage/deb, NSIS, dmg ; asar vérifié avec le worker du bloqueur)
  et CI GitHub Actions (vérifications + e2e, paquets non signés sur `master`) (ADR-015).
- Mises à jour automatiques — **plan**, non implémenté :
  1. Signature : certificat Apple Developer ID + notarisation (`notarize` d'electron-builder) et
     certificat de signature de code Windows (Authenticode, idéalement EV ou Azure Trusted Signing) ;
     secrets dans GitHub Actions, jamais dans le dépôt.
  2. Publication : releases GitHub créées par la CI sur tag `v*` (`--publish always`, provider
     `github`), avec `latest*.yml` et blockmaps pour des mises à jour différentielles.
  3. Client : `electron-updater` dans le process principal, vérification au démarrage puis toutes
     les 6 h, téléchargement en arrière-plan, installation au redémarrage proposée dans l'interface
     (jamais forcée) ; option « Mises à jour automatiques » dans les paramètres.
  4. Linux : AppImage via electron-updater ; les paquets deb passent par un dépôt apt plus tard.
  5. Canal bêta (`allowPrerelease`) pour tester avant diffusion.

## Mobile (iOS et Android) — voir ADR-016 et `mobile/README.md`

### Phase 1 — Expo Go ✅
Application Expo / React Native dans `mobile/`, lancée sur téléphone avec Expo Go, logique
partagée avec le bureau (`src/shared`) : barre d'adresse en bas repliable au défilement, balayage
pour changer d'onglet, recherche plein écran (historique, favoris, onglets, actions), vue des
onglets en grille avec espaces, onglets épinglés et transition zoom, navigation privée, appui long
sur les liens, page d'accueil, paramètres et thèmes (palette partagée), HTTPS uniquement, partage,
retours haptiques.

### Phase 2 — Version compilée (development build)
- `expo-dev-client` + EAS Build ; module Expo local avec plugin de configuration.
- Bloqueur de pubs et traqueurs : `WKContentRuleList` (iOS) et interception des requêtes
  (Android), listes EasyList/EasyPrivacy via le moteur `@ghostery/adblocker` ; compteur et
  désactivation par site comme sur le bureau.
- Onglets privés vraiment isolés sur Android (profils WebView) ; effacement des cookies et des
  données de site ; espaces isolés (conteneurs) sur les deux plateformes.
- Miniatures des onglets (`react-native-view-shot`), recherche dans la page, téléchargements,
  mode lecture, « version ordinateur » du site.
- Synchronisation chiffrée avec le bureau (favoris, onglets ouverts, historique, espaces).
- Widgets et raccourcis de l'écran d'accueil, extension de partage (« Ouvrir dans Browser »),
  navigateur par défaut.
- Publication sur l'App Store et le Play Store.
