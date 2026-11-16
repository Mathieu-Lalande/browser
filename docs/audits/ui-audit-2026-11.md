# Audit de l'interface — novembre 2026

Périmètre : les 15 pages `browser://` d'`InternalPage.svelte`, la page d'accueil, la barre latérale (complète,
compacte, zen, 232 px), la barre de fenêtre, les panneaux du calque overlay (barre universelle, menu « … »,
téléchargements, infos sur le site, options de la page, vue des onglets), la mini-fenêtre ; application mobile
en relecture statique + `npx tsc --noEmit && npx jest`.

Méthode : script Playwright jetable (fixtures e2e, `xvfb-run`) ouvrant chaque page/panneau en clair et sombre,
FR et EN, à 1280 et 700 px de large ; captures à l'échelle 1, erreurs de console et exceptions relevées, et dans
chaque page une détection DOM (défilement horizontal, texte coupé sans points de suspension, contenu débordant
d'une boîte bordée, bouton icône sans nom accessible, texte EN contenant du français). Puis recherches
textuelles : emojis, icônes hors Lucide, texte en dur, couleurs et durées en dur, `outline: none`.

Résultat brut : aucune erreur de console ni exception, aucun défilement horizontal, aucun bouton icône sans nom,
aucun emoji ni icône hors Lucide dans l'interface (bureau et mobile).

## Problèmes trouvés → corrigés

| # | Problème | Correction |
|---|----------|------------|
| 1 | `browser://tasks` : le tableau débordait de sa carte (bouton « Terminer le processus » hors cadre), et à 700 px les noms étaient réduits à « Inte… » | La colonne Tâche prend la place restante (`width: 100%; max-width: 0`, points de suspension) ; colonne Processeur masquée sous 480 px de page (`@container`) |
| 2 | Barre universelle : les raccourcis du pied étaient coupés au milieu d'un mot (« Arrière-p ») et « Échap » disparaissait (règle `@media` sur la fenêtre, pas sur la barre) | Raccourcis en ligne repliable de hauteur fixe : ceux qui ne tiennent pas passent sur une ligne masquée ; « Échap » toujours visible ; valeurs en jetons (`--space-*`, `--text-xs`) |
| 3 | Vue de tous les onglets : ni focus à l'ouverture ni Échap (fermeture au clavier impossible), `outline: none` sur les lignes (focus invisible), « Personnel · » suivi de rien pour la page d'accueil, valeurs en dur | Focus sur le panneau, Échap via `onClose` comme les autres popovers, contour de focus global, séparateur seulement s'il y a une URL, jetons d'espacement/rayon/texte, bouton fermer à `--hit-min`. Garde-fou e2e dans `ux-audit.spec.ts` |
| 4 | EN : thèmes de la galerie nommés en français (« Papier », « Nuit polaire », « Forêt »…) : `preset()` étalait l'objet et figeait le getter traduit au premier import | `preset()` copie les descripteurs (getter conservé) ; test Vitest dans `theme-share.test.ts` |
| 5 | EN : la barre universelle proposait/complétait `@réglages`, `@historique`, `@commandes` | Préfixe complet dans la langue de l'interface (nouvelles clés `omniboxScopes.*Keywords`), forme courte inchangée, les deux langues toujours acceptées ; test Vitest |
| 6 | EN : exemples d'adresse en français (`sync.exemple.fr`, `dns.exemple.fr`, `serveur-libretranslate`, bureau et mobile) | Passés par i18n (`*.serverPlaceholder`) |
| 7 | Contraste : texte rouge en dur `#e5484d`/`#ef4444` (≈ 4:1 sur fond clair) et fonds rouges en dur | `var(--danger-text)` (ajusté par thème) et `var(--danger)` partout (9 composants) |
| 8 | Contraste : texte `#fff` sur l'accent (`PopupBar`, invite de mot de passe) illisible avec un accent clair | `var(--on-accent)` |
| 9 | Animations : ~40 durées en dur (0,12 à 0,22 s, dont 0,18/0,2/0,22 s > 160 ms) | `var(--motion-fast)` / `var(--motion-base)` ; plus aucune transition d'interface hors jetons |

## Non corrigé (avec raison)

- Boucles décoratives longues (démos de `browser://welcome`, fond animé de l'accueil, indicateurs de chargement,
  surlignage d'une ligne de réglage ciblée 1,6 s) : ni transitions ni bloquantes ; coupées par
  « Réduire les animations », la préférence système et l'économiseur d'énergie (`data-reduce-motion`).
- `--text-faint` (≈ 3:1) : choix assumé de `theme.ts` (`CONTRAST.faint`) pour les indications secondaires
  (raccourcis, compteurs), jamais pour une information indispensable.
- Couleurs en dur restantes : bouton de fermeture rouge de la fenêtre (convention Windows), blancs des curseurs
  et interrupteurs, palette de la vue lecture (sépia/sombre), avertissements orange (`--warn` local aux
  téléchargements) : intentionnelles ou propres au contenu.
- Mobile : le rebond natif du défilement iOS est laissé (comportement du système, pas une animation de l'app ;
  la politique `lib/motion.ts` — pas de ressort, ≤ 120 ms — est respectée). Pas d'autre écart trouvé.
- Panneaux non ouverts par le script (installation/popup d'extension, enregistrement mot de passe/formulaire,
  traduction, note, aperçu avant impression, aperçu d'onglet) : déjà couverts par leurs e2e ; relus
  statiquement (durées et couleurs corrigées ci-dessus).
