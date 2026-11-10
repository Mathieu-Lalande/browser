# Roadmap

## En bref : où on en est
Tout ce qui suit est livré (détails dans les sprints ci-dessous et dans `docs/DECISIONS.md`, ADR-001 à 054) :
onglets, espaces et gestes, vue scindée, dossiers, grille des favoris, archivage (ADR-022), barre universelle
(ADR-032), aperçu des liens (ADR-027), mode lecture (ADR-026), boosts (ADR-029), mots de passe (ADR-025) et leur
synchronisation facultative (ADR-050), extensions et Chrome Web Store (ADR-024, 049), options de la page, captures
et vidéo (ADR-031), raccourcis personnalisables (ADR-028), galerie et partage de thèmes, mises à jour automatiques
(ADR-030), synchronisation chiffrée (ADR-019), fenêtres privées, boucliers, mise en veille, nouvel onglet à widgets
(ADR-034), mini-lecteur (ADR-035), traduction (ADR-036), notes et surlignages (ADR-037), aperçu des onglets et thème
dynamique (ADR-038), navigateur par défaut, PDF, historique et import (ADR-039), Widevine et connexion Google
(ADR-040), formulaires, clés d'accès, notifications (ADR-041), reprise, profils, tâches, impression, sauvegarde
(ADR-042), premiers pas et diagnostic (ADR-043), assistant IA (ADR-044), barre de fenêtre et menu unique (ADR-045),
bandeaux cookies et tableau de bord de confidentialité (ADR-046), panneaux web et « Lire plus tard » (ADR-047),
mini-fenêtre, économiseur d'énergie et intégration au système (ADR-048), bloqueur natif sur le téléphone (ADR-051),
interface en français et en anglais (ADR-052), API `chrome.*` des extensions (ADR-053), raccourcis et menus
persistants des extensions, téléchargements repris après un redémarrage, mémoire libérée par la veille (ADR-054) ; releases GitHub et site vitrine bilingue (ADR-023) ; application
mobile compilée avec EAS et workflow de publication vers les stores (INSTALL 2.3).

## À venir (vérifié dans le code)
- **Signature macOS** : Developer ID et notarisation (sans elles, macOS reste en « mise à jour manuelle ») ;
  dépôt apt pour le `.deb`. La signature Windows (Azure Trusted Signing ou `.pfx`) et la signature VMP de
  castLabs sont prêtes, actives dès que leurs secrets existent (ADR-040).
- **Publication mobile** : première mise en ligne sur l'App Store et Google Play (le workflow `mobile-release.yml`
  est prêt) ; droit « navigateur par défaut » d'Apple à demander (`IOS_DEFAULT_BROWSER=1` seulement après l'accord).
- **Mobile** : onglets privés isolés sur Android (seul iOS a `incognito`), espaces isolés (conteneurs), miniatures
  des onglets, recherche dans la page, téléchargements, widgets et raccourcis de l'écran d'accueil, extension de
  partage.
- **Synchronisation** : révoquer un seul appareil sans tout réinitialiser, fusion fine des titres, favicons.
- **Téléchargements** : image dans l'image pour les vidéos dans des iframes.
- **Mise en veille** : préchargement intelligent.
- **Connexion Google dans Browser** : les pages de `accounts.google.com` s'ouvrent encore dans le navigateur
  système (Google refuse les navigateurs intégrés, ADR-040).
- **Extensions** : badges et `action.onClicked` (non fournis par Electron), extensions en fenêtre privée (ADR-049).

## Sprint 0 — Fondations (terminé)
Migration Tauri → Electron + Svelte 5, onglets réels (`WebContentsView`), barre latérale verticale,
barre d'adresse, page d'accueil, raccourcis, durcissement sécurité, tests unitaires + e2e.

## Sprint 1 — Le cœur d'un vrai navigateur
- (fait) Persistance : session (onglets restaurés à la demande), historique, favoris, suggestions
  dans la barre d'adresse, sites fréquents sur la page d'accueil, paramètres (sprint 2).
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
  (fait, ADR-045) Un onglet lâché au milieu d'un autre ouvre la vue scindée.
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
  et CI GitHub Actions (vérifications + e2e ; sur `master`, paquet Linux testé ; Windows et macOS au lancement manuel) (ADR-015).
- (fait) Mises à jour automatiques (ADR-030) : `electron-updater` sur les releases GitHub, contrôle 30 s
  après le démarrage puis toutes les 6 h, téléchargement en arrière-plan, installation au redémarrage
  (jamais forcée), canaux Stable et Bêta. Signature Windows (Azure Trusted Signing ou
  `.pfx`) prête dès que ses secrets existent (ADR-040). Reste : Developer ID + notarisation macOS (sans elle, macOS reste en « mise à jour manuelle »), dépôt apt
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

### Phase 2 — Version compilée (development build)
- (fait) `expo-dev-client` + EAS Build (profils `development`, `preview`, `production`), module Expo local
  `mobile/modules/content-blocker` avec son plugin de configuration (ADR-051).
- (fait) Bloqueur de pubs et traqueurs : `WKContentRuleList` (iOS) et `shouldInterceptRequest` (Android),
  listes EasyList, EasyPrivacy et Peter Lowe converties par `src/shared/blocklist/`, masquage cosmétique,
  bandeaux cookies, bouclier par site, compteurs (ADR-051).
- (fait) Effacement des données d'un site, mode lecture et « version ordinateur » (ADR-026), synchronisation
  chiffrée avec le bureau (ADR-019), mots de passe synchronisés, notes, images du lecteur, thème dynamique
  (ADR-050), assistant IA (ADR-044), liste de lecture (ADR-047), interface en anglais (ADR-052).
- (fait) Navigateur par défaut sur Android (liens entrants dans un nouvel onglet) ; iOS : en attente du droit
  d'Apple (INSTALL 2.3).
- (fait) Fiches des stores, captures aux tailles exigées, workflow `mobile-release.yml` (build et envoi EAS).
- Reste : onglets privés vraiment isolés sur Android (profils WebView), espaces isolés (conteneurs) ; miniatures
  des onglets, recherche dans la page, téléchargements ; widgets et raccourcis de l'écran d'accueil, extension de
  partage (« Ouvrir dans Browser ») ; première publication sur l'App Store et le Play Store.
