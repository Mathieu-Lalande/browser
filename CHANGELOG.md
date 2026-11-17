# Changelog

## [0.7.0] - 2026-11-17

### Ajouté

- « Ranger les onglets » : dossiers proposés par sujet, sur l'appareil ou par l'assistant IA, validés avant tout déplacement.
- Mode concentration (`browser://focus`) avec temps passé par site, et sessions nommées (`browser://sessions`).
- Bilan des mots de passe (faibles, réutilisés, fuites par k-anonymat) et verrouillage automatique du coffre.
- Onglets épinglés ancrés à leur page, pages web sombres, sites installés comme applications, résumé IA dans l'aperçu des liens.
- Panneaux web : zoom « Ajuster », son, retour, ouverture en onglet, mise en veille, catalogue par catégories.
- Intensité des couleurs (discrète, équilibrée, vive) ; skill `/ui-review` ; page Développeurs du site.

### Corrigé

- Épingler un onglet l'ajoute aux favoris : l'étoile de la barre d'adresse s'allume et reste visible.
- Espacements des réglages (bouton collé à la liste des adresses, retraits de la section Raccourcis) et jetons d'échelle partout.

## [0.5.1] - 2026-11-04

### Ajouté

- Validation Windows de l'installation, du build et de la suite Playwright.
- Ouverture de l'authentification `accounts.google.com` dans le navigateur système.
- Documentation utilisateur, développeur, déploiement, confidentialité, sécurité et contribution.

### Corrigé

- Chemins et imports portables sous Windows.
- Normalisation des cellules CSV de mots de passe contenant des retours à la ligne.
- Suppression du rebond après un changement d'espace.
