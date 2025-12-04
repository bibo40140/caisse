# Analyse Complète de la Synchronisation Multi-Poste

**Date**: 4 décembre 2025  
**Objectif**: Garantir que toutes les données modifiées localement se synchronisent automatiquement avec Neon (source de vérité) pour un système multi-poste cohérent.

---

## Architecture de Synchronisation

### Flux de Synchronisation

```
┌─────────────┐                    ┌─────────────┐
│   Client    │                    │   Neon DB   │
│  (SQLite)   │                    │ (PostgreSQL)│
└─────────────┘                    └─────────────┘
      │                                    │
      │  1. Opération locale               │
      │     (créer/modifier/supprimer)     │
      ├───────────────────────────────────►│
      │  2. Enregistre dans ops_queue      │
      │                                    │
      │  3. Push automatique (toutes 5s)   │
      ├───────────────────────────────────►│
      │     POST /sync/push_ops            │
      │                                    │
      │  4. Serveur traite les ops         │
      │     et retourne les mappings       │
      │◄───────────────────────────────────┤
      │     { local_id → remote_uuid }     │
      │                                    │
      │  5. Client met à jour remote_uuid  │
      │                                    │
      │  6. Pull automatique (toutes 10s)  │
      │     GET /sync/pull_refs            │
      │◄───────────────────────────────────┤
      │  7. Récupère nouvelles données     │
      │     depuis Neon                    │
      │                                    │
```

### Tables Clés

- **`ops_queue`** (SQLite local): File d'attente des opérations à synchroniser
- **`ops`** (Neon): Historique des opérations appliquées (audit)
- **Tables métier** (produits, ventes, adherents, etc.): Données de l'application

---

## État de la Synchronisation par Entité

### ✅ = Synchronisé | ⚠️ = Partiel | ❌ = Non synchronisé

| Entité | Opération | Génère ops_queue? | Handler/Fichier | Serveur traite? | Statut |
|--------|-----------|-------------------|-----------------|-----------------|--------|
| **PRODUITS** |
| | Créer (UI) | ✅ Oui | `handlers/produits.js:87` (`ajouter-produit`) | ✅ `product.created` | ✅ |
| | Créer (Import CSV) | ✅ Oui | `db/imports.js:115` (`validerImportProduits`) | ✅ `product.created` | ✅ |
| | Modifier | ✅ Oui | `handlers/produits.js:149` (`modifier-produit`) | ✅ `product.updated` | ⚠️ **Voir Note 1** |
| | Supprimer | ✅ Oui | `handlers/produits.js:220` (`supprimer-produit`) | ❌ Pas implémenté | ❌ |
| | Résoudre conflit (Import) | ✅ Oui | `db/imports.js:217` (`resoudreConflitProduit`) | ✅ `product.updated` | ✅ |
| **FOURNISSEURS** |
| | Créer (UI) | ✅ Oui | `handlers/fournisseurs.js:65` (`ajouter-fournisseur`) | ✅ `fournisseur.created` | ✅ |
| | Créer (Import CSV) | ✅ Oui | `db/imports.js:344` (`validerImportFournisseurs`) | ✅ `fournisseur.created` | ✅ |
| | Modifier | ✅ Oui | `handlers/fournisseurs.js:109` (`modifier-fournisseur`) | ✅ `fournisseur.updated` | ✅ |
| | Supprimer | ❌ Non | `handlers/fournisseurs.js:149` (`supprimer-fournisseur`) | ❌ Pas implémenté | ❌ |
| **ADHÉRENTS** |
| | Créer (UI) | ✅ Oui | `handlers/adherents.js:17` (`ajouter-adherent`) | ✅ `adherent.created` | ✅ |
| | Créer (Import CSV) | ✅ Oui | `db/imports.js:461` (`validerImportAdherents`) | ✅ `adherent.created` | ✅ |
| | Modifier | ✅ Oui | `handlers/adherents.js:89` (`modifier-adherent`) | ✅ `adherent.updated` | ✅ |
| | Archiver | ✅ Oui | `handlers/adherents.js:108` (`archiver-adherent`) | ✅ `adherent.archived` | ✅ |
| | Réactiver | ✅ Oui | `handlers/adherents.js:125` (`reactiver-adherent`) | ✅ `adherent.reactivated` | ✅ |
| | Supprimer | ❌ Non | — | — | ❌ |
| **VENTES** |
| | Créer | ✅ Oui | `db/ventes.js:33` (`enregistrerVente`) | ✅ `sale.created` + `sale_line.created` | ✅ |
| | Supprimer | ❌ Non | — | — | ❌ |
| **RÉCEPTIONS** |
| | Créer | ✅ Oui | `db/receptions.js:19` (`createReception`) | ✅ `reception.created` + `reception_line.created` | ✅ |
| | Supprimer | ❌ Non | — | — | ❌ |
| **INVENTAIRE** |
| | Démarrer session | ✅ Oui | `handlers/inventory.js:243` | ✅ `inventory.session_start` | ✅ |
| | Ajouter comptage | ✅ Oui | `handlers/inventory.js:309` | ✅ `inventory.count_add` | ✅ |
| | Finaliser | ✅ Oui | `handlers/inventory.js:473` | ✅ `inventory.finalize` | ✅ |
| **STOCK (Ajustements manuels)** |
| | Ajuster (bulk) | ✅ Oui | `db/stock.js:70` (`adjustStock`) | ✅ `inventory.adjust` | ✅ |
| | Décrémenter | ❌ Non | `handlers/stock.js:7` | — | ❌ **Voir Note 2** |
| | Incrémenter | ❌ Non | `handlers/stock.js:11` | — | ❌ **Voir Note 2** |
| | Mettre à jour | ❌ Non | `handlers/stock.js:15` | — | ❌ **Voir Note 2** |
| **COTISATIONS** |
| | Ajouter | ❌ Non | `handlers/cotisations.js:30` | ❌ Pas implémenté | ❌ |
| | Modifier | ❌ Non | `handlers/cotisations.js:41` | ❌ Pas implémenté | ❌ |
| | Supprimer | ❌ Non | `handlers/cotisations.js:44` | ❌ Pas implémenté | ❌ |
| **PROSPECTS** |
| | Créer | ❌ Non | `handlers/prospects.js:36` | ❌ Pas implémenté | ❌ |
| | Modifier | ❌ Non | `handlers/prospects.js:37` | ❌ Pas implémenté | ❌ |
| | Supprimer | ❌ Non | `handlers/prospects.js:38` | ❌ Pas implémenté | ❌ |
| | Convertir en adhérent | ❌ Non | `handlers/prospects.js:42` | ❌ Pas implémenté | ❌ |
| **UNITÉS** |
| | Créer | ❌ Non | `handlers/unites.js:12` | ❌ Pas implémenté | ❌ |
| | Modifier | ❌ Non | `handlers/unites.js:18` | ❌ Pas implémenté | ❌ |
| | Supprimer | ❌ Non | `handlers/unites.js:24` | ❌ Pas implémenté | ❌ |
| **CATÉGORIES** |
| | Créer catégorie | ❌ Non | `handlers/categories.js:16` | ❌ Pas implémenté | ❌ |
| | Modifier catégorie | ❌ Non | `handlers/categories.js:17` | ❌ Pas implémenté | ❌ |
| | Supprimer catégorie | ❌ Non | `handlers/categories.js:19` | ❌ Pas implémenté | ❌ |
| | Créer famille | ❌ Non | `handlers/categories.js:8` | ❌ Pas implémenté | ❌ |
| | Modifier famille | ❌ Non | `handlers/categories.js:9` | ❌ Pas implémenté | ❌ |
| | Supprimer famille | ❌ Non | `handlers/categories.js:10` | ❌ Pas implémenté | ❌ |
| **MODES DE PAIEMENT** |
| | Créer | ❌ Non | `handlers/modes_paiement.js:25` | ❌ Pas implémenté | ❌ |
| | Modifier | ❌ Non | `handlers/modes_paiement.js:34` | ❌ Pas implémenté | ❌ |
| | Supprimer | ❌ Non | `handlers/modes_paiement.js:44` | ❌ Pas implémenté | ❌ |

---

## Notes Importantes

### **Note 1: Modification de Produits**

**Problème potentiel**: Pour que `product.updated` soit traité sur Neon, le produit **DOIT avoir** soit:
- Un `remote_uuid` (colonne `produits.remote_uuid` remplie en local)
- OU une `reference` unique

**Vérification nécessaire**:
```sql
-- Sur base locale SQLite
SELECT id, nom, remote_uuid, reference FROM produits WHERE id = <ton_produit_modifié>;

-- Si remote_uuid est NULL et que le produit a été créé localement,
-- il faut qu'il soit d'abord pushé (product.created) avant de pouvoir être modifié
```

**Solution**: 
- Toujours s'assurer que le produit a un `remote_uuid` avant de modifier
- Le premier push après création devrait remplir le `remote_uuid` via le mapping

---

### **Note 2: Opérations Stock Simples**

Les handlers `decrementer-stock`, `incrementer-stock`, `mettre-a-jour-stock` sont **obsolètes** et ne génèrent **PAS d'opérations de sync**.

**Raison**: Le stock est maintenant géré via:
1. **Ventes** → crée automatiquement des `stock_movements` (type='sale')
2. **Réceptions** → crée automatiquement des `stock_movements` (type='reception')
3. **Inventaire** → ajustements via `inventory.adjust`
4. **Ajustements manuels** → via `stock:adjust-bulk` qui génère des ops

**Action recommandée**: Supprimer ou déprécier ces 3 handlers pour éviter les désynchronisations.

---

## Entités NON Synchronisées (à implémenter)

### Priorité HAUTE 🔴

1. **Cotisations** - Important pour la gestion des adhérents
2. **Suppression de produits/fournisseurs/adhérents** - Pour maintenir la cohérence
3. **Unités** - Créées/modifiées localement mais jamais synchronisées

### Priorité MOYENNE 🟡

4. **Prospects** - Si module activé, doit être synchronisé
5. **Catégories/Familles** - Généralement définies côté serveur, mais peuvent être modifiées localement

### Priorité BASSE 🟢

6. **Modes de paiement** - Rarement modifiés, généralement définis par tenant

---

## Problèmes Identifiés et Corrigés

### ✅ Corrections Appliquées

1. **Import de produits**: Ajout de `enqueueOp()` dans `validerImportProduits()`
2. **Import de fournisseurs**: Ajout de `enqueueOp()` dans `validerImportFournisseurs()`
3. **Import d'adhérents**: Ajout de `enqueueOp()` dans `validerImportAdherents()`
4. **Doublons d'adhérents**: Amélioration du matching lors du pull (par `remote_uuid` OU `nom+email`)
5. **Database locked**: Ajout de `busy_timeout = 5000` pour gérer les conflits de transaction SQLite

---

## Tests de Validation Requis

### Pour chaque entité synchronisée

1. **Créer une donnée** localement (ex: produit, adhérent, fournisseur)
2. **Vérifier `ops_queue`**: `SELECT * FROM ops_queue WHERE ack = 0`
3. **Attendre 5s** (push automatique) ou forcer push
4. **Vérifier sur Neon**: Donnée doit apparaître dans la table métier
5. **Vérifier mapping**: `remote_uuid` doit être rempli localement
6. **Modifier la donnée** localement
7. **Vérifier mise à jour** sur Neon après push
8. **Sur un autre poste**: Attendre 10s (pull) et vérifier que la donnée apparaît

### Test Multi-Poste

**Scénario**: 2 postes (Poste A et Poste B) avec le même tenant

1. **Poste A**: Créer un produit "Pommes Bio" à 3.50€
2. **Attendre 15s** (push A → Neon → pull B)
3. **Poste B**: Vérifier que "Pommes Bio" apparaît
4. **Poste B**: Modifier le prix à 3.80€
5. **Attendre 15s** (push B → Neon → pull A)
6. **Poste A**: Vérifier que le prix est bien 3.80€
7. **Répéter** avec une vente, un adhérent, une réception

---

## Recommandations

### Court terme (Urgent)

1. ✅ **Vérifier que les produits modifiés ont un `remote_uuid`**
2. ⚠️ **Implémenter la synchronisation des cotisations**
3. ⚠️ **Implémenter la suppression synchronisée** (soft delete recommandé)
4. ⚠️ **Déprécier les handlers stock obsolètes**

### Moyen terme

5. **Ajouter la synchronisation des unités**
6. **Ajouter la synchronisation des catégories/familles** (si modification locale autorisée)
7. **Ajouter la synchronisation des prospects** (si module activé)

### Long terme

8. **Implémenter résolution de conflits** (ex: 2 postes modifient le même produit simultanément)
9. **Ajouter des logs de synchronisation** côté serveur pour debugging
10. **Implémenter sync différentiel** (ne récupérer que les changements depuis dernière sync)

---

## Conclusion

**État actuel**: La synchronisation est **fonctionnelle pour les entités principales** (produits, fournisseurs, adhérents, ventes, réceptions, inventaires).

**Problème actuel**: Les **produits modifiés** peuvent ne pas se synchroniser si:
- Le `remote_uuid` n'est pas rempli
- Le premier push (product.created) n'a pas été complété
- Le mapping n'a pas été traité correctement

**Action immédiate**: Vérifier l'état du produit modifié dans la base locale pour diagnostiquer le problème spécifique.
