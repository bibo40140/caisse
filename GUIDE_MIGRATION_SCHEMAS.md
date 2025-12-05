# Guide de Migration des Schémas

**Date:** 2025-12-05  
**Objectif:** Harmoniser les schémas SQLite (local) et PostgreSQL (Neon) pour une synchronisation robuste.

---

## 📋 Fichiers générés

1. **`SCHEMA_REFERENCE_HARMONISE.md`** : Documentation complète de tous les schémas et colonnes
2. **`caisse/migrate-local-schema.sql`** : Script SQL de migration SQLite
3. **`caisse/migrate-local-schema.js`** : Script Node.js pour migrer une base locale
4. **`caisse/migrate-all-local-dbs.js`** : Script pour migrer toutes les bases du dossier `db/`
5. **`caisse-api/sql/migrate-neon-schema.sql`** : Script SQL de migration PostgreSQL
6. **`caisse-api/migrate-neon-schema.js`** : Script Node.js pour migrer la base Neon

---

## 🚀 Procédure de migration

### ⚠️ IMPORTANT : Sauvegarde obligatoire !

Avant toute migration :
```bash
# Local (SQLite)
cp -r caisse/db caisse/db.backup-$(date +%Y%m%d)

# Neon (PostgreSQL)
# Créer un snapshot/backup via l'interface Neon ou pg_dump
```

---

## 🔧 Étape 1 : Migration Local (SQLite)

### Option A : Migrer UNE base spécifique

```bash
cd caisse
node migrate-local-schema.js db/tenant_59bef0ac-a444-4301-902a-581e7a0231c8.db
```

### Option B : Migrer TOUTES les bases d'un coup

```bash
cd caisse
node migrate-all-local-dbs.js
```

Le script va :
- ✅ Créer automatiquement une sauvegarde (`.backup-timestamp`)
- ✅ Ajouter les colonnes manquantes (`created_at`, `updated_at`, etc.)
- ✅ Créer les tables manquantes (`stock_movements`, `inventory_snapshot`, `inventory_adjust`)
- ✅ Renommer les colonnes (`receptions.date → created_at`, `prospects.date_creation → created_at`)
- ✅ Harmoniser les types (`carts.created_at/updated_at` INTEGER → TEXT ISO8601)
- ✅ Afficher un résumé détaillé

**Sortie attendue :**
```
====================================
Migration du schéma SQLite
Base de données: db/tenant_xxx.db
====================================

📦 Création d'une sauvegarde: db/tenant_xxx.db.backup-1733404800000
✅ Sauvegarde créée avec succès.

🔓 Ouverture de la base de données...
📝 Exécution de 47 commandes SQL...

====================================
📊 Résumé de la migration:
   ✅ Succès: 45
   ⏭️  Ignorées: 2
   ❌ Erreurs: 0
====================================

✅ Migration terminée avec succès !
📦 Sauvegarde disponible: db/tenant_xxx.db.backup-1733404800000
```

---

## 🌐 Étape 2 : Migration Neon (PostgreSQL)

```bash
cd caisse-api
node migrate-neon-schema.js
```

Le script va :
- ✅ Ajouter les colonnes manquantes (`created_at`, `updated_at`, `statut`, etc.)
- ✅ Créer les tables manquantes (`prospects`, `prospects_invitations` si module activé)
- ✅ Créer les index pour optimiser les requêtes sync
- ✅ Créer les triggers `updated_at` automatiques
- ✅ Afficher un résumé détaillé

**Sortie attendue :**
```
====================================
Migration du schéma PostgreSQL/Neon
====================================

📝 Exécution du script de migration...

✅ Migration Neon terminée avec succès !

🔍 Vérification des colonnes ajoutées...

📋 Colonnes created_at/updated_at présentes:

   ✅ adherents.updated_at (timestamp with time zone)
   ✅ lignes_reception.created_at (timestamp with time zone)
   ✅ lignes_reception.updated_at (timestamp with time zone)
   ✅ lignes_vente.created_at (timestamp with time zone)
   ✅ lignes_vente.updated_at (timestamp with time zone)
   ✅ produits.created_at (timestamp with time zone)
   ✅ receptions.updated_at (timestamp with time zone)
   ✅ ventes.created_at (timestamp with time zone)
   ✅ ventes.updated_at (timestamp with time zone)

====================================
✅ Migration Neon terminée !
====================================
```

---

## ✅ Étape 3 : Vérification post-migration

### Local (SQLite)

```bash
cd caisse
sqlite3 db/tenant_xxx.db

# Vérifier les colonnes
.schema produits
.schema ventes
.schema stock_movements
.schema inventory_snapshot

# Vérifier les données
SELECT COUNT(*) FROM produits;
SELECT COUNT(*) FROM ventes;
```

### Neon (PostgreSQL)

```sql
-- Vérifier les colonnes
\d produits
\d ventes
\d lignes_vente

-- Vérifier les données
SELECT COUNT(*) FROM produits;
SELECT COUNT(*) FROM ventes;

-- Vérifier les triggers
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_name LIKE '%updated%';
```

---

## 🔄 Étape 4 : Tester la synchronisation

Après la migration, tester le pull/push complet :

```bash
# Dans l'app Electron
# 1. Faire un pull complet
# 2. Vérifier que toutes les données sont récupérées
# 3. Modifier un produit
# 4. Faire un push
# 5. Vérifier côté Neon que les données sont bien à jour
```

---

## 🛑 En cas de problème

### Restaurer une base locale

```bash
cd caisse
cp db/tenant_xxx.db.backup-1733404800000 db/tenant_xxx.db
```

### Restaurer Neon

Utiliser le snapshot/backup créé avant la migration via l'interface Neon.

---

## 📊 Changements appliqués

### Local (SQLite)

| Action | Table | Colonne | Notes |
|--------|-------|---------|-------|
| ➕ ADD | `produits` | `created_at` | Date de création |
| ➕ ADD | `ventes` | `created_at` | Date système (≠ `date_vente` métier) |
| ➕ ADD | `lignes_vente` | `created_at` | Date de création |
| ➕ ADD | `lignes_reception` | `created_at` | Date de création |
| ➕ ADD | `inventory_sessions` | `user`, `notes` | Métadonnées |
| ➕ ADD | `inventory_counts` | `updated_at` | Date de modification |
| 🆕 CREATE | `stock_movements` | Toutes | Table complète |
| 🆕 CREATE | `inventory_snapshot` | Toutes | Table complète |
| 🆕 CREATE | `inventory_adjust` | Toutes | Table complète |
| 🔄 RENAME | `receptions` | `date → created_at` | Cohérence nommage |
| 🔄 RENAME | `prospects` | `date_creation → created_at` | Cohérence nommage |
| 🔄 CONVERT | `carts`, `cart_items` | `created_at`, `updated_at` | INTEGER → TEXT ISO8601 |

### Neon (PostgreSQL)

| Action | Table | Colonne | Notes |
|--------|-------|---------|-------|
| ➕ ADD | `produits` | `created_at` | Date de création |
| ➕ ADD | `ventes` | `created_at`, `updated_at` | Dates système |
| ➕ ADD | `lignes_vente` | `created_at`, `updated_at` | Dates système |
| ➕ ADD | `receptions` | `updated_at` | Date de modification |
| ➕ ADD | `lignes_reception` | `created_at`, `updated_at` | Dates système |
| ➕ ADD | `inventory_counts` | `created_at` | Date de création |
| ➕ ADD | `adherents`, `fournisseurs`, etc. | `updated_at` | Sync incrémental |
| ➕ ADD | `adherents` | `statut` | Cohérence avec local |
| 🆕 CREATE | `prospects` | Toutes | Si module activé |
| 🆕 CREATE | `prospects_invitations` | Toutes | Si module activé |
| 🔧 CREATE | Toutes les tables | Triggers `updated_at` | Auto-update |
| 📊 CREATE | Toutes les tables | Index `created_at`, `updated_at` | Performance sync |

---

## 📈 Bénéfices attendus

1. **Synchronisation robuste** : Colonnes `created_at`/`updated_at` cohérentes pour le pull incrémental
2. **Pas de perte de données** : Migrations non destructives
3. **Tables complètes** : `stock_movements`, `inventory_snapshot`, `inventory_adjust` opérationnelles
4. **Nommage cohérent** : Plus de `date`, `date_creation`, etc. → `created_at` partout
5. **Performance optimisée** : Index sur `created_at`/`updated_at` pour les requêtes sync
6. **Triggers automatiques** : `updated_at` mis à jour automatiquement côté Neon

---

## 🎯 Prochaines étapes

Après la migration :

1. ✅ Tester le pull/push complet
2. ✅ Vérifier que les données sont cohérentes entre local et Neon
3. ✅ Mettre à jour le code de sync pour utiliser `created_at`/`updated_at` correctement
4. ✅ Supprimer les anciennes sauvegardes après validation

---

**Besoin d'aide ?** Consulte `SCHEMA_REFERENCE_HARMONISE.md` pour le détail complet des colonnes.
