# Roadmap

## En bref : où on en est
Terminé (détails dans les sprints ci-dessous et dans `docs/DECISIONS.md`) : onglets, espaces et gestes, vue
scindée, dossiers, grille des favoris, archivage, barre universelle (ADR-032), aperçu des liens (ADR-027), mode
lecture (ADR-026), boosts (ADR-029), mots de passe (ADR-025), extensions (ADR-024), options de la page, captures
et vidéo (ADR-031), raccourcis personnalisables (ADR-028), galerie et partage de thèmes, mises à jour
automatiques (ADR-030), synchronisation chiffrée (ADR-019), fenêtres privées, boucliers, mise en veille,
releases GitHub et site vitrine avec guide d'utilisation (ADR-023), application mobile phase 1.

## À venir
- **Mobile phase 2** : version compilée (EAS), bloqueur de pubs et traqueurs natif, onglets privés isolés sur
  Android (détail plus bas).
- **Traduction des pages** (sans envoyer le contenu à un tiers par défaut).
- **Nouvel onglet personnalisable** : widgets, disposition, fond par espace.
- **Mini-lecteur multimédia** : contrôle de la vidéo ou de la musique d'un autre onglet depuis la barre latérale.
- **Notes et surlignages** sur les pages, retrouvables dans la barre universelle.
- **Aperçu des onglets au survol** (miniature de la page).
- **Thème dynamique** : couleur d'accent tirée du site ou du fond d'écran.
- **Refactorisation, phase 2** : découpage des gros modules de main et de l'interface, contrats IPC par fonctionnalité.

## Sprint 0 — Fondations (terminé)
Migration Tauri → Electron + Svelte 5, onglets réels (`WebContentsView`), barre latérale verticale,
barre d'adresse, page d'accueil, raccourcis, durcissement sécurité, tests unitaires + e2e.

## Sprint 1 — Le cœur d'un vrai navigateur
- (fait) Persistance : session (onglets restaurés à la demande), historique, favoris, suggestions
  dans la barre d'adresse, sites fréquents sur la page d'accueil. Reste : paramètres.
- (fait) Palette de commandes (Ctrl+K) façon Arc, devenue la barre universelle (ADR-032) : onglets ouverts, historique, favoris, actions,
  recherche floue ; calque flottant (« overlay ») au-dessus des pages, réutilisable pour menus et popovers.
- (fait) Bloqueur de pubs & traqueurs intégré, mode HTTPS uniquement, compteur et désactivation par site.
- (fait) Invite de permissions (caméra, micro, notifications…) par site.

## Sprint 2 — Personnalisation poussée
- (fait) Paramètres (`browser://settings`) appliqués à chaud : thème clair/sombre/auto, couleur d'accent
  et dégradé (palette dérivée, contraste WCAG AA), arrière-plan, densité, coins, police, ombres,
  animations réduites ; barre latérale à gauche/droite et redimensionnable, marge de page ;
  moteur de recherche ; page d'accueil (prénom, horloge, sites, fond) ; session, position des
  nouveaux onglets, onglet affiché après fermeture ; effacement de l'historique, gestion des favoris.
- (fait) Mode zen (Ctrl+Maj+B).
- (fait) Espaces (workspaces) : onglets propres, icône (Lucide) et couleur d'accent, sessions isolées optionnelles
  (conteneurs), déplacement d'onglets, Ctrl+Alt+1…9 (ADR-009).
- (fait) Vue scindée : 2 à 4 pages côte à côte, séparateurs déplaçables, Ctrl+Maj+\\ (ADR-009).
  Reste : glisser-déposer d'un onglet sur un volet pour l'ajouter.
- (fait) Raccourcis clavier configurables (ADR-028) et personnalisation par site, les « boosts » (ADR-029).

## Sprint 3 — Confort & vitesse
- (fait) Téléchargements (sans boîte de dialogue, noms uniques, pause/reprise/annulation, exécutables
  à confirmer, rien n'est ouvert automatiquement), popover dans l'overlay, `browser://downloads`,
  historique ; recherche dans la page (Ctrl+F, compteur, casse, requête gardée par onglet) ; zoom
  mémorisé par site et zoom par défaut ; image dans l'image ; indicateur de son et coupure par onglet.
  Reste : reprise des téléchargements interrompus après un redémarrage, vidéos dans des iframes
  pour l'image dans l'image.
- (fait) Mise en veille des onglets inactifs (délai réglable, jamais pour le son, les autorisations en
  attente ni les formulaires en cours ; onglets estompés ; commandes « Mettre en veille ») (ADR-014).
  Reste : préchargement intelligent, indicateur de mémoire libérée.
- (fait) Fenêtres privées (Ctrl/Cmd+Maj+N) : partition en mémoire par fenêtre, effacée à la fermeture,
  rien d'écrit sur le disque, thème privé (ADR-014).
- (fait) Anti-fingerprinting modeste : UA réduit, client hints cohérents, `Accept-Language` uniformisable.
  Hors périmètre (scripts injectés) : canvas, WebGL, polices (ADR-014).
- (fait) Packaging electron-builder (AppImage/deb, NSIS, dmg ; asar vérifié avec le worker du bloqueur)
  et CI GitHub Actions (vérifications + e2e, paquets non signés sur `master`) (ADR-015).
- (fait) Mises à jour automatiques (ADR-030) : `electron-updater` sur les releases GitHub, contrôle 30 s
  après le démarrage puis toutes les 6 h, téléchargement en arrière-plan, installation au redémarrage
  (jamais forcée), canaux Stable et Bêta. Reste : signature Windows (Authenticode / Azure Trusted Signing)
  et Developer ID + notarisation macOS (sans elle, macOS reste en « mise à jour manuelle »), dépôt apt
  pour le `.deb`.

## Organisation et outils (terminé)
- (fait) Dossiers, grille des favoris, gestes entre espaces, archivage (ADR-022).
- (fait) Menu contextuel des pages, infos sur le site, données des sites, cookies tiers (ADR-021).
- (fait) Extensions (ADR-024), mots de passe (ADR-025), mode lecture et version mobile (ADR-026),
  aperçu des liens (ADR-027), options de la page, captures et vidéo (ADR-031).
- (fait) Galerie de thèmes et thèmes partageables (ADR-030), barre universelle (ADR-032).
- (fait) Releases GitHub, site vitrine et guide d'utilisation (`site/`, ADR-023).

## Synchronisation — voir ADR-019 et `server/README.md`
- (fait) Synchronisation chiffrée de bout en bout entre le bureau et le téléphone : favoris (et
  dossiers), historique des 90 derniers jours, onglets ouverts par appareil (« Onglets de mes autres
  appareils » dans la palette, la vue des onglets et la recherche mobile), espaces, thème, moteur de
  recherche et page d'accueil. Jamais la navigation privée.
- (fait) Moteur partagé (`src/shared/sync/`) : XChaCha20-Poly1305, identifiants HMAC, dernier écrivain
  gagnant avec horloge logique hybride, pierres tombales, concurrence optimiste, nouvel essai avec
  délai exponentiel. Jumelage par QR code ou code texte, déconnexion, réinitialisation avec
  nouvelle clé.
- (fait) Relais auto-hébergé (`server/`, Node 22 sans dépendance, Docker, guides VPS + Caddy, Fly.io,
  Render). Aucun serveur fourni : la synchronisation reste désactivée tant qu'il n'est pas déployé.
- (fait, ADR-050) Synchronisation facultative des mots de passe et de la liste « Jamais pour ce site » (bureau et
  téléphone), désactivée par défaut ; l'état local du moteur pour cette collection est scellé par une clé dérivée
  de la clé de synchronisation (trousseau du système), plus aucun haché en clair sur le disque.
- Reste : révoquer un seul appareil sans tout réinitialiser, fusion fine des titres, favicons, test sur un vrai
  iPhone.

## Mobile (iOS et Android) — voir ADR-016 et `mobile/README.md`

### Phase 1 — Expo Go (terminée)
Application Expo / React Native dans `mobile/`, lancée sur téléphone avec Expo Go, logique
partagée avec le bureau (`src/shared`) : barre d'adresse en bas repliable au défilement, balayage
pour changer d'onglet, recherche plein écran (historique, favoris, onglets, actions), vue des
onglets en grille avec espaces, onglets épinglés et transition zoom, navigation privée, appui long
sur les liens, page d'accueil, paramètres et thèmes (palette partagée), HTTPS uniquement, partage,
retours haptiques.

### Phase 2 — Version compilée (development build) — à venir
- `expo-dev-client` + EAS Build ; module Expo local avec plugin de configuration.
- Bloqueur de pubs et traqueurs : `WKContentRuleList` (iOS) et interception des requêtes
  (Android), listes EasyList/EasyPrivacy via le moteur `@ghostery/adblocker` ; compteur et
  désactivation par site comme sur le bureau.
- Onglets privés vraiment isolés sur Android (profils WebView) ; effacement des cookies et des
  données de site ; espaces isolés (conteneurs) sur les deux plateformes.
- Miniatures des onglets (`react-native-view-shot`), recherche dans la page, téléchargements.
  (Mode lecture et « version ordinateur » : faits dès Expo Go, ADR-026.)
- (fait) Synchronisation chiffrée avec le bureau (favoris, onglets ouverts, historique, espaces) :
  faite dès Expo Go (ADR-019), voir ci-dessus.
- Widgets et raccourcis de l'écran d'accueil, extension de partage (« Ouvrir dans Browser »),
  navigateur par défaut.
- Publication sur l'App Store et le Play Store.
