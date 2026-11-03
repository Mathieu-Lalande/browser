# Comparer Browser à Chrome, Arc, Edge… (ADR-043)

`npm run bench` mesure Browser seul, sur la machine où il tourne. Les chiffres publiés dans `docs/perf/` et sur
le site viennent d'une machine Linux d'intégration continue (processeur partagé, affichage virtuel Xvfb) : ils
servent à suivre Browser d'une version à l'autre, **pas** à le comparer à un autre navigateur mesuré ailleurs.
Une comparaison honnête se fait sur **la même machine, dans la même session**, avec la même méthode.

## 1. Préparer la machine

- Branchée sur secteur, mode performances, aucune autre application ouverte, mises à jour système terminées.
- Même écran et même échelle d'affichage pour tous les navigateurs.
- Chaque navigateur avec un **profil neuf** (aucune extension, aucun onglet restauré, synchronisation coupée).

## 2. Browser

```bash
npm run dist:dir                                   # version empaquetée (plus proche de l'utilisateur)
node scripts/bench.mjs --executable release/linux-unpacked/browser --runs 5 --label "Mon portable"
# Windows : --executable release/win-unpacked/Browser.exe ; macOS : --executable "release/mac-arm64/Browser.app/Contents/MacOS/Browser"
```

Pour les autres navigateurs, servez exactement les mêmes pages de test : `node scripts/bench.mjs --serve 8080`
(`http://127.0.0.1:8080/page/0` à `/page/29`).

## 3. Les autres navigateurs (Chromium : Chrome, Edge, Brave, Arc)

Playwright pilote n'importe quel Chromium installé :

```js
// compare.mjs : node compare.mjs "/chemin/vers/chrome"
import { chromium } from "@playwright/test";
const executablePath = process.argv[2];
const profile = await (await import("node:fs/promises")).mkdtemp("/tmp/cmp-");
const t0 = Date.now();
const context = await chromium.launchPersistentContext(profile, { executablePath, headless: false });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("about:blank");
console.log("démarrage → premier onglet prêt", Date.now() - t0, "ms");
for (let i = 0; i < 30; i++) await (await context.newPage()).goto(`http://127.0.0.1:8080/page/${i}`);
// Mémoire : gestionnaire de tâches du navigateur (Maj+Échap) ou, pour la somme des processus,
// `ps -o rss= -p $(pgrep -d, -f "<nom du navigateur>")` (Linux/macOS), Gestionnaire des tâches (Windows).
```

Arc et Safari ne se pilotent pas ainsi : mesurez à la main (chronomètre sur 5 démarrages, mémoire relevée dans le
Moniteur d'activité après avoir ouvert les mêmes 30 pages), et faites de même pour Browser afin que la méthode
soit identique.

## 4. Publier

Indiquez toujours : la machine (processeur, mémoire, système), les versions, la méthode (script ou manuelle), le
nombre d'essais et la médiane. Ne mélangez jamais des chiffres de machines différentes dans un même tableau.
