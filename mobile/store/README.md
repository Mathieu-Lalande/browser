# Publication sur l'App Store et Google Play

Tout ce qu'il faut pour remplir App Store Connect et la Play Console. Pas à pas complet :
[`docs/INSTALL.md`, section 2.3](../../docs/INSTALL.md).

| Fichier | Contenu |
| --- | --- |
| `fr-FR/listing.md`, `en-US/listing.md` | Nom, sous-titre, descriptions, mots-clés, nouveautés, catégorie, âge, liens |
| `graphics/play-icon-512.png` | Icône Google Play (512×512) |
| `graphics/play-feature-graphic.png` | Image de présentation Google Play (1024×500) |
| `screenshots/` | Captures aux tailles des stores (voir plus bas) |

Icônes et écran de démarrage de l'app : `bash mobile/scripts/gen-icons.sh` (ImageMagick, depuis `build/icon.png`).

## Confidentialité : réponses aux questionnaires

Principe : **Browser ne collecte aucune donnée**. Rien n'est envoyé au développeur : pas de compte,
pas de statistiques, pas de rapports de plantage, pas de publicité. Les seuls envois réseau autres
que les pages visitées sont des fonctions **facultatives, désactivées par défaut**, que l'utilisateur
configure lui-même avec ses propres serveurs ou clés :

| Fonction | Ce qui part | Vers qui |
| --- | --- | --- |
| Synchronisation | Données chiffrées de bout en bout (XChaCha20-Poly1305) : le serveur ne voit aucun clair | Le serveur de l'utilisateur |
| Assistant (Claude) | Texte de la page et question, à la demande | Anthropic, avec la clé de l'utilisateur |
| Traduction | Texte de la page, à la demande | DeepL, LibreTranslate ou Google, avec la clé de l'utilisateur |
| Météo (nouvel onglet) | Nom de la ville choisie | Open-Meteo, sans clé ni cookie |

Le développeur ne reçoit jamais ces données : selon Apple et Google, un envoi direct de l'appareil
vers un service choisi et configuré par l'utilisateur, sans passer par le développeur, n'est pas
une « collecte ».

**App Store Connect → Confidentialité de l'app** : « Collectez-vous des données à partir de cette
app ? » → **Non, nous ne collectons pas de données** (étiquette « Aucune donnée collectée »).

**Play Console → Sécurité des données** :
- « Votre application collecte-t-elle ou partage-t-elle des données utilisateur des types requis ? » → **Non**.
- Chiffrement en transit : **Oui** (HTTPS ; synchronisation chiffrée de bout en bout).
- Suppression des données : aucune donnée côté développeur ; tout est sur l'appareil (désinstaller
  l'app ou Paramètres → Confidentialité) et, pour la synchronisation, sur le serveur de l'utilisateur.
- Politique de confidentialité : https://mathieu-lalande.github.io/browser/privacy.html

**Autres déclarations Play** : publicité **non** ; accès aux applications **aucune restriction**
(pas de compte) ; public cible **18 ans et plus** (accès Internet non filtré) ; application
d'actualité **non** ; ID publicitaire **non** (non utilisé).

## Conformité à l'export (chiffrement)

`ios.infoPlist.ITSAppUsesNonExemptEncryption` vaut **`true`** : en plus du HTTPS d'iOS, l'app
chiffre elle-même la synchronisation avec des **algorithmes standard** (XChaCha20-Poly1305, HKDF,
HMAC-SHA-256 via `@noble/*`), ce qui n'entre pas dans l'exemption « chiffrement du système uniquement ».
App Store Connect pose donc les questions à chaque build (*TestFlight → Conformité manquante*) :

1. « Quel type d'algorithmes de chiffrement votre app implémente-t-elle ? » → **Algorithmes de
   chiffrement standard au lieu des algorithmes de chiffrement du système d'exploitation d'Apple, ou
   en plus de ceux-ci**.
2. « Votre app sera-t-elle disponible sur l'App Store en France ? » → **Oui** : Apple demande alors la
   déclaration française. En France, la fourniture d'un moyen de cryptologie assurant la
   confidentialité relève d'une **déclaration à l'ANSSI** (décret 2007-663) ; certains produits grand
   public en sont dispensés (annexe I). À vérifier sur le site de l'ANSSI (formulaire de déclaration
   de fourniture) avant la première soumission publique ; TestFlight interne n'en a pas besoin.
3. États-Unis : produit grand public (« mass market », 5D992.c), sans rapport annuel
   d'auto-classification depuis la règle BIS de 2021.

Une fois la classification acceptée, Apple donne un code : l'ajouter dans `app.json`
(`"ITSEncryptionExportComplianceCode": "…"` dans `ios.infoPlist`) évite de répondre à chaque build.

## Captures d'écran

```bash
cd mobile && npm run store:screenshots          # thème sombre (par défaut)
SCREENSHOT_THEME=light npm run store:screenshots
```

Produit `mobile/store/screenshots/<appareil>/<écran>-<thème>.png` :

| Dossier | Taille (px) | Store |
| --- | --- | --- |
| `iphone-6.9` | 1320×2868 | App Store, iPhone 6,9" (obligatoire) |
| `iphone-6.5` | 1284×2778 | App Store, iPhone 6,5" |
| `ipad-13` | 2064×2752 | App Store, iPad 13" (obligatoire car `supportsTablet`) |
| `android-phone` | 1080×1920 | Google Play, téléphone |

Les captures ne sont pas versionnées si elles dépassent 5 Mo au total : relancer la commande.
