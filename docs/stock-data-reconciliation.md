# StockFlow — réconciliation des données historiques

## Cible Firestore
L'application utilise le databaseId nommé défini dans `firebase-applet-config.json`. Le serveur Admin et la configuration de déploiement des règles doivent utiliser exactement la même base. La méthode Admin `getFirestore(app, databaseId)` est indiquée par Firebase comme une API nommée en préversion publique : vérifie son statut et les contraintes du projet avant un déploiement de production. Référence : https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore.

## Pré-requis
Le scanner utilise Application Default Credentials. Configure localement un compte de service avec les droits minimaux de lecture sur organizations/salesOrders/stockBalances/stockMovements. Le mode application nécessite en plus l'écriture sur salesOrders et auditLogs. Ne committe jamais la clé du compte de service.

## Étape 1 — audit en lecture seule
```bash
bun run audit:stock-history -- --out=reports/stock-history-preflight.json
```
Pour une organisation :
```bash
bun run audit:stock-history -- --org-id=ORG_ID --out=reports/org-stock-history.json
```

Le rapport vérifie les allocations absentes ou incohérentes, les emplacements candidats, les quantités réservées globales, les commandes terminales avec réservation, la cohérence physique/réservé/disponible et les références de dernier mouvement.

## Étape 2 — application des seules lignes univoques
Après examen du rapport et validation métier :
```bash
bun run audit:stock-history -- --apply \
  --confirm-project-id=gen-lang-client-0581402838 \
  --confirm-database-id=ai-studio-4e748b11-48ed-4376-812d-d227459daf6d \
  --out=reports/stock-history-apply.json
```
Une réservation n'est proposée que si un seul emplacement du dépôt porte un solde réservé positif pour le produit et si ce solde couvre les allocations connues ainsi que l'ensemble des réservations historiques à ventiler. Les commandes terminales, plusieurs emplacements candidats ou soldes insuffisants restent manuels.

Le mode `--apply` relit la commande et les soldes dans une transaction, ajoute uniquement `reservationAllocations`, puis écrit un audit log. Il ne modifie aucun solde physique, quantité réservée ou mouvement. Si une donnée a changé depuis le scan, la commande est ignorée.

Les soldes historiques sans `lastMovementId` sont signalés mais jamais réparés automatiquement : il faut un inventaire vérifiable et une opération d'ouverture/ajustement justifiée, pas un mouvement inventé.
