# Déploiement et publication

## Construire

```powershell
npm run dist:win
```

Les artefacts Windows sont écrits dans `release\`. `npm run dist` produit les cibles configurées pour
la plateforme courante. Construisez chaque cible sur son système d'exploitation.

Sans certificat, Windows affiche un avertissement SmartScreen. La signature Azure Trusted Signing est
préparée dans `docs/INSTALL.md`, mais nécessite une configuration et des secrets GitHub `AZURE_*`.
Widevine/castLabs nécessite séparément un compte EVS et les secrets `EVS_ACCOUNT_NAME` et `EVS_PASSWD`.

## Publication

Après les vérifications complètes et une validation manuelle :

```powershell
npm run release:version -- 0.5.1
git push --follow-tags
```

Le tag lance le workflow de release GitHub décrit dans [`INSTALL.md`](INSTALL.md). Ne publiez pas de
secrets dans le dépôt et ne poussez pas sur `master` sans validation explicite.

## Mobile et relais

La version Expo et ses limites sont documentées dans [`../mobile/README.md`](../mobile/README.md).
Le relais de synchronisation auto-hébergé et son TLS sont documentés dans
[`../server/README.md`](../server/README.md).
