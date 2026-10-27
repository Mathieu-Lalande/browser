# Serveur de synchronisation de Browser

Petit relais à héberger soi-même pour synchroniser Browser entre le PC et le téléphone : favoris,
historique récent (90 jours, 5 000 pages au plus), onglets ouverts, espaces et thème.

**Il ne peut rien lire.** Tout est chiffré sur les appareils (XChaCha20-Poly1305, clé de 256 bits
qui ne quitte jamais vos appareils, voir l'ADR-018 dans `docs/DECISIONS.md`). Le serveur stocke des
blocs illisibles, des identifiants hachés avec une clé qu'il n'a pas, des numéros de version et des
dates. Il ne voit ni adresse, ni titre, ni nom d'appareil.

Aucun serveur n'est fourni par défaut : tant que vous n'avez pas déployé le vôtre et activé la
synchronisation dans l'application, Browser ne contacte rien.

- Node.js 22, **aucune dépendance** à l'exécution (`node:http`, `node:crypto`, fichiers JSON).
- Un fichier par compte dans `DATA_DIR/accounts/`, écrit de façon atomique.
- Jeton d'accès stocké haché (SHA-256), limite de requêtes par adresse, corps de requête limité
  (2 Mo), quota par compte (64 Mo), pas de CORS : toute requête venant d'une page web est refusée.
- Le TLS (https) est assuré par un proxy inverse (Caddy, Fly.io, Render…) : le relais parle http.

## Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `8787` | Port d'écoute |
| `HOST` | `0.0.0.0` | Adresse d'écoute (`127.0.0.1` derrière un proxy sur la même machine) |
| `DATA_DIR` | `./data` | Dossier des données (à sauvegarder) |
| `REGISTRATION_SECRET` | *(vide)* | **Conseillé.** Code demandé pour créer un compte (champ « Code d'inscription » de l'app). Sans lui, n'importe qui connaissant l'adresse peut créer un compte et consommer de l'espace. |
| `TRUST_PROXY` | `0` | `1` derrière un proxy de confiance : la limite de requêtes utilise `X-Forwarded-For` |
| `RATE_LIMIT_PER_MINUTE` | `300` | Requêtes par minute et par adresse |
| `MAX_ACCOUNT_MB` | `64` | Quota par compte |
| `QUIET` | `0` | `1` coupe le journal (qui ne contient de toute façon ni identifiant, ni jeton, ni adresse IP) |

Choisissez un code d'inscription long et aléatoire, par exemple :

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## Essai en local

```bash
cd server
npm ci
npm run build
REGISTRATION_SECRET=mon-code npm start      # http://localhost:8787
npm test                                    # tests (Vitest)
```

L'application accepte `http://` uniquement pour une adresse locale (`localhost`, `192.168.x.x`,
`10.x.x.x`, `*.local`…). Pratique pour un essai sur le Wi-Fi de la maison : sur le téléphone, utilisez
l'adresse IP du PC (`http://192.168.1.20:8787`). Pour un usage réel, passez par https.

## Option 1 — Un VPS avec Caddy (le plus simple à maîtriser)

Pour un petit serveur Linux (Debian/Ubuntu, 1 vCPU / 512 Mo suffisent) et un nom de domaine
(`sync.exemple.fr`) dont l'enregistrement DNS A/AAAA pointe vers le serveur.

1. Installez Docker (`curl -fsSL https://get.docker.com | sh`) puis copiez le dossier `server/`
   sur le serveur (`scp -r server/ moi@vps:~/browser-sync`).
2. Construisez et lancez le relais, accessible seulement depuis la machine elle-même :

   ```bash
   cd ~/browser-sync
   docker build -t browser-sync .
   docker run -d --name browser-sync --restart unless-stopped \
     -p 127.0.0.1:8787:8787 \
     -v browser-sync-data:/data \
     -e REGISTRATION_SECRET='votre-code-secret' -e TRUST_PROXY=1 \
     browser-sync
   ```

3. Installez Caddy (`apt install caddy`) et mettez dans `/etc/caddy/Caddyfile` :

   ```
   sync.exemple.fr {
       encode gzip
       reverse_proxy 127.0.0.1:8787
   }
   ```

   puis `systemctl reload caddy`. Caddy obtient et renouvelle seul le certificat Let's Encrypt.
4. Vérifiez : `curl https://sync.exemple.fr/healthz` doit répondre `{"ok":true}`.
5. Ouvrez seulement les ports 80 et 443 dans le pare-feu (`ufw allow 80,443/tcp`).

Mise à jour : `git pull`, `docker build -t browser-sync .`, `docker rm -f browser-sync` puis la
commande `docker run` ci-dessus (les données restent dans le volume `browser-sync-data`).

Sans Docker : `npm ci && npm run build`, puis un service systemd qui lance `node dist/main.js` avec
les variables ci-dessus (`Environment=...`, `User=` dédié, `DATA_DIR=/var/lib/browser-sync`).

## Option 2 — Fly.io

1. Installez `flyctl` et connectez-vous (`fly auth login`).
2. Dans `server/` : `fly launch --no-deploy` (il détecte le `Dockerfile` ; choisissez une région
   proche, refusez les bases de données proposées).
3. Créez un volume pour les données et le secret :

   ```bash
   fly volumes create browser_sync_data --size 1
   fly secrets set REGISTRATION_SECRET='votre-code-secret' TRUST_PROXY=1
   ```

4. Dans `fly.toml`, montez le volume et indiquez le port :

   ```toml
   [[mounts]]
     source = "browser_sync_data"
     destination = "/data"

   [http_service]
     internal_port = 8787
     force_https = true
     auto_stop_machines = "stop"
     auto_start_machines = true
     min_machines_running = 0
   ```

5. `fly deploy`. L'adresse est `https://<nom-de-l-app>.fly.dev` (ou votre domaine avec `fly certs add`).

Gardez **une seule machine** (`fly scale count 1`) : les données sont dans un volume local.

## Option 3 — Render

1. Nouveau *Web Service* depuis votre dépôt GitHub, **Root Directory** `server`, environnement
   **Docker**.
2. Ajoutez un **Disk** monté sur `/data` (1 Go). Sans disque, les données sont perdues à chaque
   déploiement : un disque demande une offre payante.
3. Variables d'environnement : `REGISTRATION_SECRET`, `TRUST_PROXY=1` (Render fournit `PORT`).
4. Health check path : `/healthz`. L'adresse est `https://<service>.onrender.com`.

## Jumeler le PC et l'iPhone

1. **Sur le PC** : Paramètres (`Ctrl+,`) → **Synchronisation** → *Premier appareil* : collez
   l'adresse du serveur (`https://sync.exemple.fr`) et le code d'inscription, puis « Activer la
   synchronisation ». Une clé de chiffrement est créée sur le PC.
2. Toujours sur le PC : « Afficher le code de jumelage ». Lisez l'avertissement : ce code donne un
   accès complet à vos données synchronisées. Un QR code s'affiche.
3. **Sur l'iPhone** (Browser dans Expo Go ou l'app compilée) : Paramètres → **Synchronisation** →
   « Scanner le code de jumelage », autorisez l'appareil photo et visez le QR code. (Ou copiez le
   code texte du PC et collez-le dans « Ou collez le code ».)
4. Le téléphone récupère favoris, historique récent, espaces et thème du compte. Les onglets ouverts
   de chaque appareil apparaissent dans « Onglets de mes autres appareils » (PC : palette `Ctrl+K`
   et paramètres ; téléphone : vue des onglets, section « Autres appareils », et la recherche).
5. Masquez le code une fois le jumelage fait. Pour un autre PC, collez le même code dans
   *Rejoindre un compte existant*.

La synchronisation a lieu au démarrage, quelques secondes après chaque changement, toutes les
5 minutes, et sur le téléphone à chaque retour au premier plan. Les fenêtres et onglets privés ne
sont jamais synchronisés.

- **Déconnecter cet appareil** : arrête la synchronisation sur l'appareil et le retire de la liste
  des autres ; ses données locales restent.
- **Réinitialiser la synchronisation** (code perdu, appareil volé) : efface tout le compte sur le
  serveur et en crée un nouveau avec une nouvelle clé ; les autres appareils sont déconnectés et
  doivent être jumelés à nouveau avec le nouveau code.

## Sauvegarde et exploitation

- Sauvegardez `DATA_DIR` (volume Docker `browser-sync-data`). Une sauvegarde ne contient que des
  données chiffrées ; sans la clé d'un appareil, elle est inutilisable (y compris pour vous : si
  tous vos appareils sont perdus, la clé l'est aussi, et les appareils gardent de toute façon leurs
  propres données).
- `GET /healthz` pour la supervision.
- Supprimer un compte à la main : arrêtez le relais et effacez `DATA_DIR/accounts/<id>.json`.

## Protocole

Voir `src/server.ts` (et `src/shared/sync/protocol.ts` côté application) :
`POST /v1/accounts`, `GET /v1/collections/:nom?since=<version>`, `POST /v1/collections/:nom`
(écriture par lot, concurrence optimiste, 409 en cas de conflit), `DELETE /v1/account`.
Authentification : `Authorization: Bearer <compte>.<jeton>`.
