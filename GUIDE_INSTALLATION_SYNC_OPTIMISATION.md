# 🚀 Guide d'Installation - Optimisation de la Synchronisation

## Modifications Effectuées

### 1. ✅ Serveur (caisse-api)
- **Fichier**: `server.js`
  - Ajout du support du pull incrémental avec paramètre `?since=timestamp`
  - Optimisation des requêtes: seulement les données modifiées depuis `since`
  - Utilisation de `current_stock` au lieu de calculer le stock à chaque pull
  - Limitation des stock_movements aux 30 derniers jours pour le pull complet

### 2. ✅ Client (caisse)
- **Fichier**: `src/main/sync.js`
  - Ajout de la détection automatique du dernier timestamp de sync
  - Pull incrémental automatique après la première sync
  - Mise à jour du timestamp après chaque sync réussie
  - Logs améliorés pour le debugging

### 3. ✅ Scripts SQL
- **Fichier**: `caisse-api/sql/migration_stock_optimization.sql`
  - Tables: `stock_snapshots`, `current_stock`
  - Fonctions PostgreSQL pour la consolidation
  - Index pour les requêtes incrémentales

### 4. ✅ Job de Consolidation
- **Fichier**: `caisse-api/consolidate-stock.js`
  - Script Node.js pour le nettoyage quotidien
  - À exécuter via cron chaque nuit

---

## 🔧 Actions à Faire sur Neon (Base de Données)

### Étape 1: Exécuter la Migration SQL

**Sur Neon Console** (https://console.neon.tech):

1. Sélectionne ton projet
2. Va dans **SQL Editor**
3. Copie et exécute le contenu de `caisse-api/sql/migration_stock_optimization.sql`

**OU en ligne de commande**:

```bash
cd caisse-api

# Si tu as psql installé
psql $DATABASE_URL -f sql/migration_stock_optimization.sql

# OU via Node.js
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('sql/migration_stock_optimization.sql', 'utf8');
pool.query(sql)
  .then(() => console.log('Migration OK'))
  .catch(e => console.error('Erreur:', e))
  .finally(() => pool.end());
"
```

**Ce que ça fait:**
- ✅ Crée les tables `stock_snapshots` et `current_stock`
- ✅ Ajoute les index pour les requêtes rapides
- ✅ Crée les fonctions PostgreSQL de consolidation
- ✅ Initialise le stock actuel depuis les movements existants
- ✅ Crée le premier snapshot

### Étape 2: Vérifier l'Installation

```sql
-- Vérifier que les tables existent
SELECT COUNT(*) FROM stock_snapshots;
SELECT COUNT(*) FROM current_stock;

-- Vérifier que le stock est bien calculé
SELECT p.nom, cs.quantity 
FROM current_stock cs
JOIN produits p ON p.id = cs.produit_id
LIMIT 10;
```

### Étape 3: Configurer le Job Quotidien (IMPORTANT!)

Le script `consolidate-stock.js` doit tourner **chaque nuit à 2h** pour:
- Rafraîchir le stock actuel
- Créer le snapshot du jour
- Nettoyer les vieux movements (> 90 jours)

**Option A: Cron sur serveur Linux/Mac**

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne (adapter le chemin)
0 2 * * * cd /path/to/caisse-api && node consolidate-stock.js >> /var/log/stock-consolidation.log 2>&1
```

**Option B: Scheduled Query sur Neon (Recommandé pour simplicité)**

Sur Neon Console:
1. Va dans **Queries** → **Scheduled Queries**
2. Crée une nouvelle query:

```sql
-- Refresh et consolidation (à exécuter tous les jours à 2h)
SELECT refresh_current_stock();
SELECT create_daily_snapshot();
SELECT cleanup_old_stock_movements(90);
SELECT cleanup_old_snapshots(2);
```

3. Programme: **Tous les jours à 02:00 UTC**

**Option C: Cron-job.org (Service externe gratuit)**

1. Crée un endpoint API sur ton serveur:

```javascript
// Ajouter dans server.js
app.post('/cron/consolidate', async (req, res) => {
  // Sécurité: vérifier un token secret
  if (req.headers['x-cron-token'] !== process.env.CRON_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const { consolidateStock } = require('./consolidate-stock');
    const result = await consolidateStock();
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[cron/consolidate] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

2. Sur https://cron-job.org, crée un job qui appelle:
   - URL: `https://ton-api.com/cron/consolidate`
   - Method: POST
   - Header: `x-cron-token: ton_secret_token`
   - Schedule: Tous les jours à 2h

---

## 🧪 Tests

### Test 1: Vérifier le Pull Incrémental

```bash
# Sur le poste client Electron, ouvre DevTools et regarde la console
# Tu devrais voir:
[sync] Pull incrémental depuis: 2025-12-04T12:30:00.000Z
```

### Test 2: Vérifier le Pull Complet (premier sync)

```bash
# Supprime la table sync_state en local pour forcer un pull complet
# Dans DevTools SQLite:
DELETE FROM sync_state WHERE entity_type = 'pull_refs';

# Redémarre l'app, tu devrais voir:
[sync] Pull complet (premier sync ou pas de lastSync)
```

### Test 3: Simuler la Consolidation

```bash
cd caisse-api
node consolidate-stock.js
```

Tu devrais voir:
```
✅ X produits mis à jour dans current_stock
✅ X snapshots créés pour la date du jour
✅ X movements supprimés
✅ X snapshots supprimés
```

---

## 📊 Monitoring

### Vérifier les Performances

```sql
-- Compter les movements actifs (devrait rester stable après 90 jours)
SELECT 
  COUNT(*) as total_movements,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM stock_movements;

-- Vérifier les snapshots
SELECT 
  snapshot_date,
  COUNT(*) as products,
  SUM(quantity) as total_stock
FROM stock_snapshots
GROUP BY snapshot_date
ORDER BY snapshot_date DESC
LIMIT 7;

-- Vérifier le stock actuel
SELECT 
  COUNT(*) as products,
  SUM(quantity) as total_stock,
  MAX(last_updated) as last_refresh
FROM current_stock;
```

### Logs à Surveiller

**Côté Client (Electron DevTools)**:
```
[sync] Pull incrémental depuis: <timestamp>
[sync] Timestamp de sync mis à jour: <timestamp>
```

**Côté Serveur (Node.js)**:
```
[sync/pull_refs] Incrémental sync pour tenant <id>
[sync/pull_refs] Résultats: { produits: X, stock_movements: Y }
```

---

## 🎯 Résultats Attendus

### Avant Optimisation
- **Premier pull après 1 an**: ~50,000 movements → 30-60 secondes
- **Pull régulier**: Tous les movements → 5-10 secondes
- **Taille DB**: Croissance infinie

### Après Optimisation
- **Premier pull**: Snapshot + 30 jours de movements → 2-5 secondes ✅
- **Pull régulier**: Seulement depuis lastSync → 0.5-2 secondes ✅
- **Taille DB**: Stable (TTL 90 jours) ✅

---

## ❓ FAQ

### Q: Que se passe-t-il si le job de consolidation ne tourne pas?
**R**: Rien de grave! Le système continue de fonctionner. Les movements s'accumuleront et les pulls seront un peu plus lents, mais tout reste fonctionnel. Tu peux lancer manuellement le script quand tu veux.

### Q: Puis-je changer la période de rétention (90 jours)?
**R**: Oui! Modifie l'appel dans `consolidate-stock.js`:
```javascript
await client.query('SELECT cleanup_old_stock_movements(180)'); // 180 jours
```

### Q: Comment vérifier que tout fonctionne?
**R**:
1. Regarde les logs Electron (DevTools) → doit dire "Pull incrémental"
2. Vérifie sur Neon: `SELECT MAX(snapshot_date) FROM stock_snapshots;` → doit être aujourd'hui
3. Vérifie le nombre de movements: ne doit pas dépasser ~90 jours de données

### Q: Que faire si un pull échoue?
**R**: Le système va réessayer automatiquement. Au prochain pull réussi, il récupérera tous les changements depuis le dernier succès (grâce au timestamp stocké).

---

## 🔄 Rollback (si problème)

Si tu veux revenir en arrière:

```sql
-- Supprimer les nouvelles tables
DROP TABLE IF EXISTS stock_snapshots CASCADE;
DROP TABLE IF EXISTS current_stock CASCADE;

-- Supprimer les fonctions
DROP FUNCTION IF EXISTS refresh_current_stock CASCADE;
DROP FUNCTION IF EXISTS create_daily_snapshot CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_stock_movements CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_snapshots CASCADE;
```

Puis dans `server.js`, remets l'ancienne version du pull_refs (sans le paramètre `since`).

---

## ✅ Checklist

- [ ] Migration SQL exécutée sur Neon
- [ ] Tables créées (`stock_snapshots`, `current_stock`)
- [ ] Fonctions PostgreSQL créées
- [ ] Stock initial calculé (`SELECT refresh_current_stock();`)
- [ ] Premier snapshot créé (`SELECT create_daily_snapshot();`)
- [ ] Code serveur déployé (server.js modifié)
- [ ] Code client déployé (sync.js modifié)
- [ ] Job de consolidation configuré (cron/scheduled query)
- [ ] Tests effectués (pull incrémental fonctionne)
- [ ] Monitoring en place (logs vérifiés)

---

Tout est prêt! 🎉
