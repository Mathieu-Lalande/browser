# Mesures de performance

Mesuré le 2026-11-03 sur Linux CI (conteneur) (linux 6.18.44-fc-v230, Intel(R) Xeon(R) Processor @ 2.10GHz, 4 cœurs, 16 Go), build dev (out/, non empaquetée), Browser 0.4.0, Electron 44.9.3, commit 885d29d.

| Mesure | Médiane | Min | Max |
| --- | ---: | ---: | ---: |
| Démarrage à froid → premier rendu de l'interface | 481 ms | 467 ms | 528 ms |
| Démarrage à froid → barre latérale prête | 533 ms | 500 ms | 572 ms |
| Nouvel onglet → page d'accueil interactive | 26,5 ms | 24,7 ms | 29,4 ms |
| Mémoire, 1 onglet | 874,8 Mo | 874,8 Mo | 874,8 Mo |
| Mémoire, 10 onglets | 1 904,3 Mo | 1 904,3 Mo | 1 904,3 Mo |
| Mémoire, 30 onglets | 4 223,2 Mo | 4 223,2 Mo | 4 223,2 Mo |
| Mémoire, 30 onglets dont 29 en veille | 939,4 Mo | 939,4 Mo | 939,4 Mo |

5 démarrages à froid, 8 nouveaux onglets ; pages locales servies par le script (aucun réseau).
Mémoire : somme du « working set » de tous les processus (`app.getAppMetrics()`) ; sous Linux, chaque processus y compte
aussi les pages partagées (bibliothèques, mémoire GPU partagée) : la somme surestime l'empreinte réelle, mais reste
comparable d'une version à l'autre.
Ces chiffres ne se comparent qu'avec d'autres navigateurs mesurés sur la même machine : voir `scripts/bench-compare.md`.
