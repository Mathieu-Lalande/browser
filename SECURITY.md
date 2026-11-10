# Politique de sécurité

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique pour une vulnérabilité exploitable. Utilisez les avis privés de sécurité
GitHub du dépôt `Mathieu-Lalande/browser`. Si ce canal n'est pas disponible, contactez le mainteneur
via l'adresse publiée dans son profil GitHub et ne joignez que les informations nécessaires.

Indiquez la version, le système, les étapes de reproduction, l'impact et une preuve minimale. Ne joignez
aucune donnée personnelle, clé API, mot de passe ou secret de production.

## Versions prises en charge

Seule la dernière version publiée (release GitHub, et la dernière version des stores pour le téléphone)
reçoit des correctifs de sécurité ; les mises à jour automatiques l'installent (ADR-030).

## Périmètre

Le périmètre couvre le bureau Electron (y compris l'installation d'extensions depuis le Chrome Web Store,
le gestionnaire de mots de passe et l'assistant IA), l'application mobile, le relais `server/` et le site
`site/`. Le modèle de sécurité est décrit dans les ADR-003 et 018. Les limitations
documentées dans [`docs/DECISIONS.md`](docs/DECISIONS.md), notamment les protections anti-fingerprint
de Chromium et les fonctions dépendant de certificats externes, ne sont pas des vulnérabilités en soi.
