# Politique de confidentialité technique

## Principes

Browser traite la navigation, l'historique, les mots de passe et les réglages localement par défaut.
Les fenêtres privées utilisent une session en mémoire et ne sont pas synchronisées.

Les pages web n'ont ni preload, ni accès Node, ni accès à l'IPC. Les permissions, téléchargements,
favicons et données sensibles passent par le process principal et les services de session.

## Services facultatifs

- L'assistant IA utilise uniquement la clé Anthropic fournie par l'utilisateur et envoie uniquement
  le contenu explicitement demandé ; les réponses ne sont pas conservées par Browser.
- La traduction contacte le fournisseur choisi dans les réglages.
- La synchronisation chiffre les données sur les appareils avant l'envoi au relais ; le relais ne reçoit
  pas le clair. Voir [`../server/README.md`](../server/README.md).
- Les rapports de plantage sont désactivés par défaut et nécessitent un accord explicite.

## Limites

Le modèle anti-fingerprint harmonise l'User-Agent, les client hints réseau et `Accept-Language`, mais
ne prétend pas masquer toutes les propriétés de Chromium. Google est ouvert dans le navigateur système
pour éviter l'authentification intégrée refusée par Google.

Cette page décrit le comportement technique du code ; elle ne remplace pas un avis juridique.
