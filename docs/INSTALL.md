# Installer et distribuer Browser

Browser n'est pas un site web : c'est une **application** à installer, en deux versions qui partagent
leur logique (`src/shared`).

| Version | Dossier | Techno | Plateformes |
| --- | --- | --- | --- |
| Bureau | `/` | Electron (Chromium) + Svelte | Windows, macOS, Linux |
| Mobile | `mobile/` | Expo / React Native (WebKit sur iOS, WebView Chromium sur Android) | iPhone, iPad, Android |

---

## 1. Développement

### Sur le PC (Windows)

Prérequis : [Node.js 22 LTS](https://nodejs.org) et Git.

```powershell
git clone https://github.com/Mathieu-Lalande/browser.git
cd browser
npm install        # télécharge aussi le binaire Electron (scripts/ensure-electron.mjs)
npm run dev        # ouvre le navigateur, l'interface se recharge à chaque modification
```

Mise à jour : `git pull` puis `npm install` (si `package.json` a changé), puis `npm run dev`.

Vérifications : `npm run typecheck`, `npm test` et `npm run test:e2e` (tests de bout en bout ; sous Linux
sans affichage : `xvfb-run -a npm run test:e2e`).

> Conseil : évite un dossier synchronisé par OneDrive pour le dépôt (ex. `C:\dev\browser`). OneDrive
> verrouille parfois des fichiers de `node_modules` pendant `npm install` et ralentit tout.

Dans l'application, `Alt` + `←` revient à la page précédente et `Alt` + `→` avance dans l'historique.
Sur macOS, un balayage horizontal à deux ou trois doigts sur le pavé tactile déclenche les mêmes actions
(balayage vers la droite pour revenir, vers la gauche pour avancer).

### Sur l'iPhone (ou Android), depuis le PC

1. Installe **Expo Go** depuis l'App Store (ou le Play Store), version à jour (SDK 58).
2. Sur le PC :
   ```powershell
   cd browser\mobile
   npm install
   npx expo start
   ```
3. Scanne le QR code : sur iPhone avec l'appareil photo, puis « Ouvrir dans Expo Go » ; sur Android
   depuis Expo Go.
4. Le PC et le téléphone doivent être sur le **même Wi-Fi**. Sinon : `npx expo start --tunnel`.
   Si le pare-feu Windows demande l'accès pour Node.js, autorise-le sur les réseaux privés.

Chaque modification du code se recharge sur le téléphone en direct. Dépannage : `mobile/README.md`.

Limite d'Expo Go : pas de code natif sur mesure. Le bloqueur de pubs (ADR-051) n'y fait que masquer
les éléments publicitaires et refuser les bandeaux cookies ; le blocage des requêtes (traqueurs,
scripts publicitaires) demande l'app compilée, le « client de développement » ci-dessous.

### Client de développement (bloqueur complet)

Le module natif `mobile/modules/content-blocker` (Swift `WKContentRuleList` sur iOS, Kotlin
`shouldInterceptRequest` sur Android) n'existe que dans une app compilée. Le client de développement
est cette app, avec en plus le rechargement à chaud comme Expo Go :

1. `npm install` dans `mobile/` applique le correctif de `react-native-webview` (`patches/`, patch-package)
   et construit les listes (`scripts/build-blocklists.mjs` : EasyList, EasyPrivacy et la liste de Peter
   Lowe, convertis par `src/shared/blocklist/`). Hors ligne, une petite liste de secours est utilisée ;
   `npm run blocklists` reconstruit après coup. Les fichiers produits ne sont jamais commités.
2. Compiler sur les serveurs d'Expo (ni Mac ni Android Studio nécessaires) :
   ```powershell
   cd browser\mobile
   npx eas-cli build --profile development --platform android   # APK à installer directement
   npx eas-cli build --profile development --platform ios       # iPhone enregistré (eas device:create)
   ```
   (`development-simulator` pour le simulateur iOS ; `preview` pour une version sans serveur de dev.)
3. Installer l'app obtenue (lien/QR donné par EAS), puis sur le PC `npx expo start --dev-client` et
   ouvrir le projet depuis l'app.
4. Tester : Réglages → Confidentialité affiche « Bloqueur de pubs et traqueurs » sans la mention
   « Bloqueur complet disponible dans l'app compilée ». Ouvrir un site chargé en publicités : les
   emplacements sont vides ; sur Android, le cadenas → « Bouclier » montre le nombre de traqueurs
   bloqués (iOS ne fournit pas ce compte). « Désactiver le bouclier sur ce site » recharge la page
   sans blocage.

Après une mise à jour de `react-native-webview`, `npm install` signale un correctif qui ne s'applique
plus (et échoue en CI/EAS), et `expo prebuild` refuse de continuer sans lui : refaire le correctif (ADR-051).

---

## 2. Utilisation au quotidien et distribution

### 2.1 Bureau (Windows, macOS, Linux)

**Pour toi, sur ton PC :**

```powershell
npm run dist
```

L'installateur est créé dans `release\` (`Browser-Setup-x.y.z-x64.exe` sous Windows). Lance-le : Browser
s'installe comme n'importe quel navigateur (menu Démarrer, raccourci, désinstallation).

- Construis chaque plateforme **sur son système** : l'installateur Windows sur Windows, le `.dmg` sur
  un Mac. Sous Linux, on obtient un AppImage et un `.deb`.
- Sans signature, Windows affiche « Windows a protégé votre ordinateur » (SmartScreen) :
  « Informations complémentaires » → « Exécuter quand même ». macOS bloque l'app : clic droit → Ouvrir.

**Pour la distribuer à d'autres personnes :**

1. **Intégration continue** : `.github/workflows/ci.yml` vérifie chaque push. Sur `master`, il construit
   les versions décompressées pour Windows, macOS et Linux, à télécharger dans l'onglet *Actions* de
   GitHub (« artifacts »).
2. **Signature** (indispensable pour un public large) :
   - Windows : certificat de signature de code (Azure Trusted Signing est le moins cher et le plus
     simple aujourd'hui), sinon SmartScreen avertit chaque utilisateur ;
   - macOS : compte Apple Developer (abonnement annuel), certificat *Developer ID* et notarisation.
     C'est le même compte que pour l'App Store iOS.
3. **Publication** : voir la section 2.2 ci-dessous, qui décrit aussi les mises à jour automatiques.

### 2.2 Publier une version (release GitHub) et le site vitrine

Le workflow `.github/workflows/release.yml` construit les installateurs sur Windows, macOS et Linux et
les publie dans une **release GitHub** (ADR-023).

1. Sur `master`, à jour et sans modification en cours :
   ```powershell
   npm run release:version -- 0.3.0     # ou patch / minor / major
   git push --follow-tags
   ```
   `npm version` met à jour `package.json` et `package-lock.json`, crée le commit « Version 0.3.0 » et
   le tag `v0.3.0`. Le push du tag lance le workflow **Release**.
2. Variante sans tag local : onglet *Actions* → **Release** → *Run workflow*, saisir la version (`0.3.0`).
   Le tag `v0.3.0` est créé sur le commit choisi (sans modifier `package.json` du dépôt).
3. Une vingtaine de minutes plus tard, la release apparaît dans l'onglet **Releases** du dépôt
   (`https://github.com/Mathieu-Lalande/browser/releases`), avec des notes générées automatiquement :

   | Fichier | Contenu |
   | --- | --- |
   | `Browser-Setup-<version>-x64.exe` / `-arm64.exe` | Installateur Windows (NSIS) |
   | `Browser-<version>-win-x64.zip` / `-arm64.zip` | Version portable Windows |
   | `Browser-<version>-mac-arm64.dmg` / `-x64.dmg` | macOS Apple Silicon / Intel |
   | `Browser-<version>-mac-arm64.zip` / `-x64.zip` | macOS, archive servant aux mises à jour |
   | `Browser-<version>-linux-….AppImage`, `….deb` | Linux 64 bits |
   | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `*.blockmap` | Métadonnées des mises à jour automatiques |
   | `SHA256SUMS.txt` | Empreintes SHA-256 de tous les fichiers |

   Une version avec un suffixe (`0.3.0-beta.1`) est publiée en *pre-release*.

**Mises à jour automatiques (ADR-030).** L'application installée vérifie les releases GitHub (via
`electron-updater` et les fichiers `latest*.yml` ci-dessus) 30 s après le démarrage puis toutes les 6 h,
télécharge la nouvelle version en arrière-plan et l'installe au prochain redémarrage (ou tout de suite
avec « Redémarrer pour mettre à jour », dans la barre latérale ou le menu Fichier). Réglages dans
*Paramètres → Mises à jour* : téléchargement automatique, canal **Stable** ou **Bêta** (les
*pre-releases* `0.3.0-beta.1` ne sont proposées qu'au canal Bêta), « Rechercher des mises à jour ».
- Windows : installation par l'installateur NSIS uniquement (la version portable `.zip` ne se met pas à
  jour seule). Non signée, la mise à jour fonctionne, SmartScreen pouvant avertir à nouveau.
- Linux : l'AppImage se met à jour seule ; le paquet `.deb` non (mise à jour manuelle).
- macOS : Squirrel.Mac exige une app signée avec un certificat *Developer ID*. Tant que les paquets
  sont signés *ad hoc*, l'app affiche « Mise à jour manuelle requise » avec un lien vers la page de la
  release. Il suffit d'ajouter les secrets de signature macOS pour que la mise à jour devienne automatique.
- Jamais en développement (`npm run dev`) ; `--disable-updates` les coupe aussi dans une app installée.
- Ne jamais supprimer une release publiée dont les `latest*.yml` sont la dernière version : les
  applications installées ne trouveraient plus leurs fichiers.

L'installateur Windows propose une installation **pour l'utilisateur courant** (par défaut, sans droits
administrateur) ou pour tous les utilisateurs, le choix du dossier, un raccourci dans le menu Démarrer,
une case « Créer un raccourci sur le Bureau » en fin d'installation, et un désinstallateur
(Paramètres → Applications). Le profil (favoris, session) est conservé à la désinstallation.
Pour construire l'installateur sur un PC Windows : `npm run dist:win` (sortie dans `release\`).

**Signature (facultative).** Sans secrets, les paquets sont construits non signés (SmartScreen et
Gatekeeper avertissent ; sur macOS, signature *ad hoc* pour éviter le message « endommagé » sur
Apple Silicon). Tous les secrets se rangent dans *Settings → Secrets and variables → Actions → New
repository secret* ; chaque signature s'active seule dès que ses secrets existent (ADR-040).

*Windows avec Azure Trusted Signing (recommandé, environ 10 $/mois).* Pas de clé USB ni de fichier
`.pfx` : Microsoft garde le certificat, renouvelé tous les jours, et SmartScreen fait confiance aux
fichiers signés bien plus vite qu'avec un certificat classique.

1. Créer un compte Azure (<https://portal.azure.com>, carte bancaire demandée) et un abonnement
   « Paiement à l'utilisation ».
2. Dans le portail, rechercher **Trusted Signing Accounts** (« Comptes de signature approuvée »),
   *Créer* : un groupe de ressources (ex. `browser-signing`), un nom de compte (ex. `browser-signing`,
   c'est `AZURE_SIGNING_ACCOUNT`), une région (ex. *West Europe*) et le niveau **Basic**. Noter
   l'**URI du compte** affichée sur sa page (ex. `https://weu.codesigning.azure.net/`, c'est
   `AZURE_SIGNING_ENDPOINT` : elle dépend de la région).
3. Se donner le rôle **Trusted Signing Identity Verifier** sur ce compte (*Contrôle d'accès (IAM) →
   Ajouter une attribution de rôle*), puis *Identity validation → New identity → Public* : nom légal,
   adresse et pièce d'identité (particulier : vérification par Microsoft/Au10tix, quelques jours ; une
   entreprise doit exister depuis 3 ans). Attendre le statut **Completed**.
4. *Certificate profiles → Create → Public Trust*, choisir l'identité validée. Le nom du profil
   (ex. `browser`) est `AZURE_CERTIFICATE_PROFILE` ; le **nom commun (CN)** du certificat affiché par le
   profil (votre nom légal, ex. `Mathieu Lalande`) est `AZURE_PUBLISHER_NAME`, à recopier exactement.
5. Créer l'identité de la CI : *Microsoft Entra ID → Inscriptions d'applications → Nouvelle
   inscription* (ex. `browser-release`). Noter l'**ID d'application (client)** (`AZURE_CLIENT_ID`) et
   l'**ID de l'annuaire (locataire)** (`AZURE_TENANT_ID`). *Certificats et secrets → Nouveau secret
   client* : copier sa **valeur** tout de suite (`AZURE_CLIENT_SECRET`, à renouveler avant expiration).
6. Sur le compte Trusted Signing, *Contrôle d'accès (IAM) → Ajouter une attribution de rôle* :
   **Trusted Signing Certificate Profile Signer** pour l'application `browser-release`.
7. Ajouter les sept secrets GitHub : `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`, `AZURE_PUBLISHER_NAME`.
8. Publier une version : le journal du job Windows affiche « Signature Windows : Azure Trusted
   Signing » ; clic droit sur l'installateur → *Propriétés → Signatures numériques* pour vérifier.

Une fois les versions signées, `publisherName` est inscrit dans `app-update.yml` : la mise à jour
automatique refuse alors tout installateur qui ne serait pas signé par ce nom (ne plus changer de nom
légal ou de certificat sans publier d'abord une version de transition). Les installations non signées
existantes acceptent la première version signée.

*Windows avec un certificat classique* (`.pfx` d'une autorité de certification, à défaut d'Azure) :
`WIN_CSC_LINK` (le `.pfx` en base64 ou une URL https) et `WIN_CSC_KEY_PASSWORD` ; electron-builder lit
le nom de l'éditeur dans le certificat. Azure est prioritaire si ses secrets sont présents.

*macOS* : `CSC_LINK` et `CSC_KEY_PASSWORD` (la notarisation Apple n'est pas encore configurée).

**Contenus protégés (Widevine, Netflix…).** Le bureau est construit sur *Electron for Content
Security* de castLabs (dépendance `electron` = `github:castlabs/electron-releases#v<version>+wvcus`,
binaire téléchargé depuis les releases castLabs par `scripts/ensure-electron.mjs` et par
electron-builder via `build.electronDownload`). Le module Widevine est téléchargé au premier lancement
(Paramètres → Confidentialité → « Contenus protégés (DRM) » affiche sa version). Pour que Netflix,
Disney+ ou Prime Video acceptent de lire en production sous Windows et macOS, l'application
empaquetée doit être **signée VMP** par castLabs (gratuit) :

1. Installer Python 3 puis `python -m pip install --upgrade castlabs-evs`.
2. Créer le compte : `python -m castlabs_evs.account signup` (nom de compte, adresse e-mail, mot de
   passe, code reçu par e-mail). Gratuit, pour un usage commercial comme personnel.
3. Ajouter les secrets GitHub `EVS_ACCOUNT_NAME` et `EVS_PASSWD`. Le workflow de release installe
   alors `castlabs-evs` et les crochets `scripts/vmp-after-pack.cjs` / `vmp-after-sign.cjs` signent
   l'application (macOS : avant la signature Apple ; Windows : après Authenticode).
4. En local : `EVS_ACCOUNT_NAME=… EVS_PASSWD=… npm run dist:win` signe de même ; sans ces variables,
   rien n'est signé. Vérifier : `python -m castlabs_evs.vmp verify-pkg release/win-unpacked`.

Sans signature VMP, Widevine s'installe mais les services exigeant une plateforme vérifiée refusent la
lecture (ou la limitent en basse définition). Sous Linux, pas de VMP : le module Widevine n'y est pas
distribué par le service de composants de castLabs, le réglage affiche « Widevine indisponible ».
Pour revenir à Electron standard : remettre `"electron": "^44.x.y"` dans `package.json`, retirer
`build.electronDownload`, `npm install` ; le code détecte l'absence de l'API `components` et le
réglage affiche « Widevine indisponible ».

**Connexion Google.** Google refuse les « navigateurs intégrés ». Browser se présente comme Google
Chrome de la même version (agent utilisateur sans « Electron » ni nom d'application, en-têtes
`Sec-CH-UA` avec les marques de Chrome), ce qui est vérifié par les tests e2e. La connexion réelle à
un compte Google reste à **vérifier à la main** à chaque montée de version d'Electron (Windows :
accounts.google.com → se connecter, puis Gmail), Google pouvant changer ses contrôles.

**Site vitrine.** Le dossier `site/` (Vite + TypeScript, sans framework) est publié sur GitHub Pages par
`.github/workflows/site.yml` à chaque push sur `master` qui touche `site/`. **Une seule fois** :
*Settings → Pages → Build and deployment → Source : GitHub Actions*. Adresse :
**https://mathieu-lalande.github.io/browser/**. Deux pages, deux entrées Vite (`site/vite.config.ts`) publiées dans
`site/dist/` : la vitrine (`index.html`) et le guide d'utilisation (`docs.html`, à tenir à jour avec les
fonctionnalités et les raccourcis de `src/shared/commands.ts`). Le bouton de téléchargement détecte le système du
visiteur et pointe vers le bon fichier de la dernière release (API GitHub), ou vers la page des
releases s'il n'y en a pas encore ou si l'API ne répond pas.

En local : `cd site && npm ci && npm run dev` (ou `npm run build && npm run preview`).

### 2.3 iPhone et Android : TestFlight, App Store, Google Play (EAS)

Expo Go sert au développement. Pour avoir **Browser comme une vraie app**, il faut une version
compilée. On passe par **EAS** (le service d'Expo) : il compile iOS dans le cloud (pas besoin de Mac)
et envoie les builds aux stores. Tout est prêt dans le dépôt :

| Fichier | Rôle |
| --- | --- |
| `mobile/app.json` | Nom « Browser », identifiants `com.mathieulalande.browser`, icônes, écran de démarrage, textes des permissions (français), chiffrement, liens http/https (Android) |
| `mobile/app.config.ts` | Partie dynamique : identifiant du projet EAS, `eas update`, navigateur par défaut iOS |
| `mobile/eas.json` | Profils `development` (dev client), `preview` (APK / iOS ad hoc), `production` (stores, numéro de build incrémenté par EAS) et envoi aux stores |
| `mobile/store/` | Fiches FR/EN, réponses de confidentialité et de chiffrement, images Google Play, captures |
| `.github/workflows/mobile-release.yml` | Build + envoi depuis GitHub (bouton *Run workflow*) |

**Versions** : `expo.version` (`app.json`, à garder égal à `mobile/src/lib/version.ts`) est la version
affichée (0.1.0). Le numéro de build iOS (`buildNumber`) et Android (`versionCode`) est tenu **par EAS**
(`"appVersionSource": "remote"`) et incrémenté à chaque build `production` (`autoIncrement`) : ne
pas les écrire dans `app.json`. Pour une nouvelle version visible, monter `expo.version`.

#### Étape 1 : comptes (une fois)

1. **Expo** : créer un compte gratuit sur https://expo.dev.
2. **Apple Developer Program** (99 $/an) : https://developer.apple.com/programs/enroll/ avec ton
   identifiant Apple (double authentification activée). Compte « Individuel » : le nom affiché sur
   l'App Store sera le tien. Validation : de quelques heures à deux jours. C'est le même compte que
   pour signer la version macOS du bureau.
3. **Google Play Console** (25 $, une fois) : https://play.google.com/console/signup, compte
   personnel, vérification d'identité. Attention : un **compte personnel récent** doit faire tester
   l'app par au moins 12 testeurs pendant 14 jours (test fermé) avant de pouvoir la publier en
   production ; le test **interne** utilisé ici n'a pas cette limite.

#### Étape 2 : lier le projet à Expo (une fois)

```powershell
cd mobile
npm install
npm install -g eas-cli
eas login
eas init                  # crée le projet sur expo.dev
```

`eas init` affiche un identifiant de projet : l'ajouter dans `app.json`, sous `expo` :
`"extra": { "eas": { "projectId": "<identifiant>" } }` (s'il ne l'a pas fait lui-même). Cela active aussi
`eas update`. Puis fixer le premier numéro de build : `eas build:version:set` (choisir 1, pour iOS
puis pour Android).

#### Étape 3 : créer l'app dans App Store Connect

1. https://appstoreconnect.apple.com → **Apps** → **+** → **Nouvelle app** : plateforme iOS, nom
   « Browser » (s'il est pris, « Browser – Navigateur privé » : le nom sous l'icône reste
   « Browser »), langue principale **Français**, identifiant de lot `com.mathieulalande.browser`
   (s'il n'est pas proposé : https://developer.apple.com/account/resources/identifiers → **+** →
   App IDs → App, Bundle ID explicite `com.mathieulalande.browser`), SKU `browser-mobile`.
2. Noter l'**identifiant Apple** de l'app (*Informations sur l'app* → *Identifiant Apple*, un nombre)
   et ton **Team ID** (https://developer.apple.com/account → *Membership*).
3. Dans `mobile/eas.json`, sous `submit.production.ios`, ajouter
   `"ascAppId": "<identifiant Apple de l'app>"` et `"appleTeamId": "<Team ID>"` (ce ne sont pas des
   secrets).

#### Étape 4 : premier build iOS et TestFlight

```powershell
eas build --platform ios --profile production
```

La première fois, EAS demande de se connecter au compte Apple et crée **lui-même** le certificat de
distribution et le profil de provisionnement (répondre oui). Puis :

```powershell
eas submit --platform ios --latest
```

EAS propose de créer une **clé d'API App Store Connect** : accepter (elle est stockée sur EAS et
sert aussi à GitHub Actions). Une dizaine de minutes après, le build apparaît dans **App Store
Connect → TestFlight** :

1. **Conformité à l'export** : l'app déclare utiliser du chiffrement (`ITSAppUsesNonExemptEncryption`
   = `true`, à cause de la synchronisation chiffrée). Répondre comme indiqué dans
   [`mobile/store/README.md`](../mobile/store/README.md) (section « Conformité à l'export » :
   algorithmes standard, disponibilité en France).
2. **Test interne** : *TestFlight* → *Testeurs internes* → **+**, s'ajouter (jusqu'à 100 membres de
   l'équipe App Store Connect, sans revue d'Apple).
3. Sur l'iPhone, installer l'app **TestFlight**, accepter l'invitation, installer Browser.
4. Testeurs externes (jusqu'à 10 000, par lien public) : demandent une revue rapide d'Apple et la
   page *Informations de test* (adresse de contact, description).

#### Étape 5 : créer l'app dans la Play Console et premier envoi

1. https://play.google.com/console → **Créer une application** : nom « Browser », langue par défaut
   **Français – fr-FR**, application, gratuite ; accepter les déclarations.
2. **Premier fichier à la main** (Google n'accepte l'envoi par API qu'après un premier envoi) :
   ```powershell
   eas build --platform android --profile production
   ```
   Télécharger le `.aab` depuis la page du build (lien affiché), puis Play Console → *Tester et
   publier* → **Tests internes** → *Créer une release* → déposer le `.aab` (accepter la **signature
   d'application par Google Play**) → enregistrer, publier pour le test interne.
3. **Testeurs** : *Tests internes* → *Testeurs* → créer une liste (ton adresse Gmail), copier le lien
   d'inscription, l'ouvrir sur le téléphone Android puis installer depuis le Play Store.
4. **Clé de compte de service** pour `eas submit` (une fois) : Google Cloud Console → projet lié à la
   Play Console → *IAM* → *Comptes de service* → créer, puis *Clés* → *Ajouter une clé* → JSON. Dans la
   Play Console → *Utilisateurs et autorisations* → inviter l'adresse du compte de service, droits
   « Publier sur les canaux de test » et « Gérer les releases » pour l'app Browser. Enregistrer le
   fichier sous `mobile/secrets/google-play-service-account.json` (ignoré par git). Ensuite :
   ```powershell
   eas submit --platform android --latest     # piste « internal », en brouillon
   ```
5. Les **fiches** : textes, mots-clés et liens dans `mobile/store/fr-FR/listing.md` et
   `en-US/listing.md` ; icône 512×512 et image de présentation 1024×500 dans `mobile/store/graphics/` ;
   questionnaires *Sécurité des données*, *Classification du contenu*, *Public cible* et confidentialité
   App Store : réponses dans `mobile/store/README.md`. Politique de confidentialité :
   https://mathieu-lalande.github.io/browser/privacy.html ; assistance :
   https://mathieu-lalande.github.io/browser/support.html.

#### Étape 6 : captures d'écran

```powershell
cd mobile
npm run store:screenshots        # sous Linux/WSL (Playwright + Electron du dépôt)
```

Produit `mobile/store/screenshots/<appareil>/` aux tailles exigées : iPhone 6,9" (1320×2868),
iPhone 6,5" (1284×2778), iPad 13" (2064×2752, obligatoire car l'app accepte l'iPad) et téléphone
Android (1080×1920). `SCREENSHOT_THEME=light` pour la version claire. Les icônes de l'app se
régénèrent depuis `build/icon.png` avec `npm run store:icons` (ImageMagick).

#### Étape 7 : versions suivantes

- Depuis le PC : `eas build --platform all --profile production --auto-submit` (build iOS et
  Android, numéro de build incrémenté, envoi à TestFlight et au test interne Play).
- Depuis GitHub : ajouter les secrets du dépôt (*Settings → Secrets and variables → Actions*) :
  `EXPO_TOKEN` (https://expo.dev → *Account settings* → *Access tokens*), et pour l'envoi
  `ASC_APP_ID`, `APPLE_TEAM_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (contenu du fichier JSON), plus
  `EAS_PROJECT_ID` si `app.json` ne le contient pas. Puis *Actions* → **Mobile release** → *Run
  workflow*. Sans `EXPO_TOKEN`, le workflow ne fait rien.
- **Correctifs JavaScript seuls** (sans code natif ni nouvelle dépendance native) :
  `eas update --channel production --message "…"` ; les apps installées le récupèrent au lancement
  suivant. La version d'exécution suit `expo.version` : après un changement natif, monter la version
  et refaire un build.
- **Publication** : App Store Connect → page de la version → choisir le build, remplir la fiche,
  *Soumettre pour vérification* (classification 17+, « Accès Internet illimité »). Play Console →
  promouvoir la release du test interne vers la production.

Profils utiles pendant le développement : `eas build --profile development` (dev client, à la place
d'Expo Go, puis `npx expo start --dev-client`) et `--profile preview` (APK à installer directement
sur Android ; iOS « ad hoc », après `eas device:create` pour enregistrer l'iPhone).

#### Navigateur par défaut

**Android** : l'app déclare ouvrir les liens `http`/`https` (`intentFilters` de `app.json`) : après
installation, *Paramètres → Applications → Applications par défaut → Application de navigateur* →
Browser. Un lien ouvert depuis une autre app arrive dans un **nouvel onglet**
(`mobile/src/hooks/useIncomingLinks.ts`). Le lien `browser-mobile://open?url=<adresse encodée>` fait
de même sur les deux systèmes.

**iOS** : être navigateur par défaut demande le droit `com.apple.developer.web-browser`, accordé par
Apple sur demande :

1. Avoir l'app dans App Store Connect (étape 3). Vérifier les exigences d'Apple : champ d'adresse
   et recherche, vraies pages web (WKWebView), pas d'interface limitée à quelques sites, pas de
   redirection vers une autre app ou un site imposé.
2. Envoyer la demande : https://developer.apple.com/contact/request/web-browser-entitlement/
   (identifiant de lot `com.mathieulalande.browser`). Réponse d'Apple par e-mail, souvent sous
   quelques jours à quelques semaines.
3. Une fois accordé : developer.apple.com → *Identifiers* → `com.mathieulalande.browser` →
   cocher la capacité « Default Web Browser » (elle n'apparaît qu'après l'accord).
4. Construire avec `IOS_DEFAULT_BROWSER=1` (par exemple dans `eas.json`, `build.production.env`) :
   `app.config.ts` ajoute alors le droit et la déclaration des schémas `http`/`https` exigée par Apple.
   Puis `eas credentials` → iOS → production → régénérer le profil de provisionnement (il doit
   contenir le nouveau droit) et refaire un build. **Ne pas** activer cette variable avant l'accord :
   le profil de provisionnement ne pourrait pas être créé.
5. Sur l'iPhone : *Réglages → Apps → Browser → App de navigation par défaut*.

**Phase 2 mobile** (`docs/ROADMAP.md`) : la version compilée permet d'ajouter du code natif, et
donc le bloqueur de pubs et de vrais onglets privés isolés sur Android. La synchronisation avec le
bureau, elle, fonctionne déjà dans Expo Go (section 3).

---

## 3. Synchroniser le PC et l'iPhone

La synchronisation (favoris, historique récent, onglets ouverts, espaces, thème) passe par **votre
propre serveur**, qui ne voit que des données chiffrées (ADR-019). Aucun serveur n'est fourni :
tant que vous n'en avez pas déployé un, elle reste simplement désactivée.

1. **Déployer le serveur** : dossier `server/`, guide pas à pas dans [`server/README.md`](../server/README.md)
   (VPS avec Docker et Caddy, Fly.io ou Render ; quelques minutes, un petit serveur suffit).
   Choisissez un `REGISTRATION_SECRET` : sans lui, n'importe qui peut créer un compte sur votre serveur.
2. **Sur le PC** : Paramètres → Synchronisation → *Premier appareil* : adresse du serveur
   (`https://sync.exemple.fr`) et code d'inscription → « Activer la synchronisation ».
3. Toujours sur le PC : « Afficher le code de jumelage » (après l'avertissement : ce code donne
   accès à toutes vos données synchronisées).
4. **Sur l'iPhone** : Browser → Paramètres → Synchronisation → « Scanner le code de jumelage »
   (fonctionne dans Expo Go : `expo-camera` y est inclus). Ou collez le code texte.
5. Les onglets de l'autre appareil apparaissent dans « Onglets de mes autres appareils » (PC : `Ctrl+K`)
   et dans la vue des onglets du téléphone (« Autres appareils »).

Pour tester sans serveur public : `cd server && npm ci && npm run build && npm start` sur le PC,
puis l'adresse `http://<IP-du-PC>:8787` (http n'est accepté que pour une adresse du réseau local).

Vérifications du serveur : `cd server && npm test` (ou `npm run test:server` à la racine).

---

## 4. Récapitulatif

| Besoin | Bureau | iPhone |
| --- | --- | --- |
| Développer | `npm run dev` | Expo Go + `npx expo start` |
| L'utiliser au quotidien soi-même | `npm run dist` → installateur | EAS Build → TestFlight (compte Apple Developer) |
| Le distribuer | `npm run release:version` → release GitHub + site vitrine (signature à venir) | App Store (revue Apple) |
| Synchroniser | Paramètres → Synchronisation (serveur auto-hébergé, `server/`) | Paramètres → Synchronisation → Scanner |
