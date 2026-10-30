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

Vérifications : `npm run typecheck`, `npm test` et `npm run test:e2e` (tests de bout en bout).

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

Limite d'Expo Go : pas de code natif sur mesure, donc **pas de bloqueur de pubs** sur mobile tant
qu'on n'est pas passé à une version compilée (section 2.3).

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
3. **Publication** : voir la section 2.2 ci-dessous. Les mises à jour automatiques (`electron-updater`)
   viendront avec la signature (`docs/ROADMAP.md`, Sprint 3).

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
   | `Browser-<version>-linux-….AppImage`, `….deb` | Linux 64 bits |
   | `SHA256SUMS.txt` | Empreintes SHA-256 de tous les fichiers |

   Une version avec un suffixe (`0.3.0-beta.1`) est publiée en *pre-release*.

L'installateur Windows propose une installation **pour l'utilisateur courant** (par défaut, sans droits
administrateur) ou pour tous les utilisateurs, le choix du dossier, un raccourci dans le menu Démarrer,
une case « Créer un raccourci sur le Bureau » en fin d'installation, et un désinstallateur
(Paramètres → Applications). Le profil (favoris, session) est conservé à la désinstallation.
Pour construire l'installateur sur un PC Windows : `npm run dist:win` (sortie dans `release\`).

**Signature (facultative).** Sans secrets, les paquets sont construits non signés (SmartScreen et
Gatekeeper avertissent ; sur macOS, signature *ad hoc* pour éviter le message « endommagé » sur
Apple Silicon). Pour signer, ajouter dans *Settings → Secrets and variables → Actions* :
`WIN_CSC_LINK` (certificat `.pfx` en base64) et `WIN_CSC_KEY_PASSWORD` pour Windows, `CSC_LINK` et
`CSC_KEY_PASSWORD` pour macOS (la notarisation Apple n'est pas encore configurée).

**Site vitrine.** Le dossier `site/` (Vite + TypeScript, sans framework) est publié sur GitHub Pages par
`.github/workflows/site.yml` à chaque push sur `master` qui touche `site/`. **Une seule fois** :
*Settings → Pages → Build and deployment → Source : GitHub Actions*. Adresse :
**https://mathieu-lalande.github.io/browser/**. Le bouton de téléchargement détecte le système du
visiteur et pointe vers le bon fichier de la dernière release (API GitHub), ou vers la page des
releases s'il n'y en a pas encore ou si l'API ne répond pas.

En local : `cd site && npm ci && npm run dev` (ou `npm run build && npm run preview`).

### 2.3 iPhone (et Android) sans Expo Go

Expo Go sert au développement. Pour avoir **Browser comme une vraie app** sur l'écran d'accueil,
avec son icône, il faut une version compilée. Depuis Windows, on passe par **EAS Build** (le
service de compilation d'Expo, qui compile iOS dans le cloud : pas besoin de Mac).

Étapes (une fois) :

```powershell
cd mobile
npm install -g eas-cli
eas login                 # compte Expo gratuit
eas build:configure       # crée eas.json
```

**iPhone :**

1. Il faut un **compte Apple Developer Program** (payant, annuel) : Apple n'autorise pas l'installation
   durable d'une app sur iPhone sans ce compte (sans Mac). C'est aussi celui qui sert à signer la
   version macOS du bureau.
2. `eas build --platform ios --profile production`, puis `eas submit --platform ios`.
3. L'app arrive dans **TestFlight** : tu l'installes sur ton iPhone via l'app TestFlight, et tu peux
   inviter des testeurs. Chaque nouvelle version se publie de la même façon.
4. **App Store** (public) : fiche, captures, politique de confidentialité, puis revue d'Apple. Apple
   exige qu'un navigateur iOS utilise WebKit : c'est le cas (`react-native-webview` → WKWebView).
   Optionnel ensuite : demander le droit d'être **navigateur par défaut** sur iOS.

**Android :**

- Pour toi : `eas build --platform android --profile preview` produit un `.apk` à installer
  directement (autoriser les « sources inconnues »).
- Public : compte Google Play Console (paiement unique), `eas build --platform android` (fichier
  `.aab`), puis `eas submit --platform android`.

**Mises à jour rapides** : une fois l'app compilée, `eas update` envoie les changements de code
JavaScript sans repasser par la revue des stores (le code natif, lui, demande un nouveau build).

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
