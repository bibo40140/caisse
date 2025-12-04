# 🎯 Actions à Faire - Résumé Rapide

## Sur Neon (Base de Données) - OBLIGATOIRE

### 1. Exécuter la migration SQL

```bash
# Option 1: Via psql
cd caisse-api
psql $DATABASE_URL -f sql/migration_stock_optimization.sql

# Option 2: Copier/coller dans Neon Console SQL Editor
# Le fichier: caisse-api/sql/migration_stock_optimization.sql
```

### 2. Configurer le job quotidien (IMPORTANT!)

**Option recommandée: Scheduled Query sur Neon**

1. Va sur https://console.neon.tech
2. Sélectionne ton projet
3. Queries → Scheduled Queries → New Query
4. Copie ce SQL:

```sql
SELECT refresh_current_stock();
SELECT create_daily_snapshot();
SELECT cleanup_old_stock_movements(90);
SELECT cleanup_old_snapshots(2);
```

5. Schedule: **Tous les jours à 02:00**
6. Active la query

---

## Sur le Serveur (caisse-api) - OBLIGATOIRE

### Redémarrer le serveur API

```bash
cd caisse-api

# Arrêter le serveur actuel (Ctrl+C si lancé manuellement)

# Relancer
npm start
# OU
node server.js
```

---

## Sur chaque Poste Client (Electron) - OBLIGATOIRE

### Redémarrer l'application

```bash
cd caisse

# Build si nécessaire
npm run build

# Lancer l'app
npm start
```

**OU** simplement fermer et relancer l'application déjà installée.

---

## Vérification Rapide

### 1. Vérifier sur Neon

```sql
-- Ces requêtes doivent retourner des données
SELECT COUNT(*) FROM stock_snapshots; -- > 0
SELECT COUNT(*) FROM current_stock;   -- > 0
```

### 2. Vérifier sur le Client

Ouvre DevTools dans l'app Electron (Ctrl+Shift+I) et regarde la console.

**Au démarrage, tu devrais voir:**
```
[sync] Pull complet (premier sync) OU Pull incrémental depuis: <date>
```

**Après quelques minutes:**
```
[sync] Pull incrémental depuis: 2025-12-04T...
[sync] Timestamp de sync mis à jour: 2025-12-04T...
```

---

## C'est Tout! ✅

Le système est maintenant optimisé:
- ✅ Pull incrémental automatique (seulement les changements)
- ✅ Consolidation quotidienne (nettoyage automatique)
- ✅ Performances constantes même après des années

---

## En cas de Problème

### Si le pull ne fonctionne pas

1. Vérifie les logs serveur: `npm start` dans caisse-api
2. Vérifie les logs client: DevTools Console dans Electron
3. Vérifie que la migration SQL a été exécutée:
   ```sql
   SELECT * FROM pg_tables WHERE tablename IN ('stock_snapshots', 'current_stock');
   ```

### Si le job quotidien ne tourne pas

- Vérifie dans Neon Console → Scheduled Queries
- OU lance manuellement: `node caisse-api/consolidate-stock.js`

### Besoin d'aide?

Regarde le guide complet: `GUIDE_INSTALLATION_SYNC_OPTIMISATION.md`
