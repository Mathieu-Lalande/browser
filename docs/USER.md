# Guide d'utilisation

## Installer et démarrer

Sous Windows, lancez l'installateur `Browser-Setup-x.y.z-x64.exe`, puis choisissez Browser dans
**Paramètres Windows → Applications → Applications par défaut** pour les liens HTTP/HTTPS et les PDF.
Les versions non signées peuvent déclencher SmartScreen.

En développement :

```powershell
npm install
npm run dev
```

## Navigation

- `Ctrl+K` ouvre la barre universelle ; `Ctrl+H` ouvre l'historique.
- `Ctrl+P` imprime ou enregistre la page en PDF.
- `Ctrl+Maj+N` ouvre une fenêtre privée.
- `Ctrl+Alt+1…9` change d'espace.
- `Ctrl+F` recherche dans la page ; `Ctrl+Alt+R` active le mode lecture.
- `Ctrl+Maj+O` ouvre les options de page : zoom, captures et vidéo.

Les gestes du pavé tactile sont pris en charge : balayage horizontal à deux doigts pour précédent/suivant
quand la page ne peut plus défiler, et pincement pour le zoom. Le changement d'espace n'ajoute pas
d'animation de rebond.

## Données et réglages

Les pages internes commencent par `browser://`. L'import depuis Chrome, Edge, Brave, Vivaldi, Opera,
Firefox et Arc se trouve dans `browser://import`. Les mots de passe importés nécessitent un export CSV.
La synchronisation est facultative et chiffrée de bout en bout ; elle nécessite votre propre relais
(`server/README.md`).

Google refuse les connexions depuis les navigateurs intégrés : les pages HTTPS de
`accounts.google.com` sont ouvertes dans le navigateur système. Les autres sites, dont Okta, restent
dans Browser.

Pour les problèmes, utilisez « Signaler un problème » dans l'application et joignez la version, le
système et les étapes de reproduction ; n'envoyez jamais de secret.
