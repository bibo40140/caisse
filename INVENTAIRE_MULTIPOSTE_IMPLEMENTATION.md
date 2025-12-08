# 🎯 Inventaire Multiposte/Multitenant - Implementation Complete

## ✅ Modifications Réalisées

### Phase 1: Nettoyage Routes API (Task 1-2)
**Fichiers modifiés:**
- `caisse-api/routes/inventory.js` - **NOUVELLE VERSION UNIFIÉE**
- `caisse-api/server.js` - Suppression de `inventoryExtraRouter`

**Endpoints Disponibles:**
1. `POST /inventory/start` - Crée/réutilise session d'inventaire
2. `GET /inventory/sessions?status=open|closed|all` - Liste les sessions
3. `POST /inventory/:sessionId/count-add` - Ajoute comptage (accumulation par device)
4. `GET /inventory/:sessionId/summary` - Résumé complet avec deltas
5. `POST /inventory/:sessionId/finalize` - Finalisation avec snapshot + ajustements
6. `GET /inventory/:sessionId/counts` - Détails par device (multiposte)

**Caractéristiques:**
- ✅ Tout UUID-based (produit_id, session_id, tenant_id)
- ✅ `ON CONFLICT DO UPDATE` pour accumulation des comptages
- ✅ Session locking (status='finalizing') contre doubles finalisations
- ✅ Snapshot automatique des stocks avant finalisation
- ✅ Stock movements créés pour audit trail
- ✅ Agrégation multi-devices avec `device_id`

**Schéma Neon Aligné:**
- Colonne `produit_id` (pas `produit_id`) dans toutes les tables
- API accepte `produit_id` dans body pour compatibilité, convertit en `produit_id` en interne

---

### Phase 2: Migration FK Locale (Task 3)
**Fichier modifié:**
- `caisse/src/main/db/schema.js` - **Migration 3 ajoutée**

**Changement:**
```sql
-- AVANT (ligne 562):
FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE

-- APRÈS:
-- Pas de FK sur produit_id (permet comptage produits non synchro localement)
```

**Impact:**
- Permet de compter des produits qui n'existent pas encore localement
- Identique au pattern des `cart_items` (Migrations 1 et 2)
- Exécution automatique au démarrage si FK détectée

---

### Phase 3: Standardisation UUID Produits (Task 4)
**Fichier modifié:**
- `caisse/src/main/handlers/inventory.js` - `applySummaryToLocal()`

**Changement:**
```javascript
// AVANT: Recherche dans 5 colonnes différentes
const uuidCols = ['remote_uuid', 'remote_id', 'neon_id', 'product_uuid', 'uuid'];

// APRÈS: Colonne unique `remote_uuid`
SELECT id, COALESCE(remote_uuid, '') AS remote_uuid, 
       COALESCE(code_barre, '') AS code_barre 
FROM produits
```

**Impact:**
- Mapping UUID→ID local simplifié
- Fallback sur code-barres si UUID non trouvé
- Moins de fragilitité dans le matching

---

### Phase 4: Synchronisation Sessions Distantes (Task 5)
**Fichiers modifiés:**
- `caisse/src/main/sync.js` - Ajout dans `pullRefs()`
- `caisse-api/server.js` - Ajout dans `GET /sync/pull_refs`

**Backend (`server.js` ligne ~920):**
```javascript
client.query(`
  SELECT id, name, status, started_at, ended_at, "user", notes
  FROM inventory_sessions
  WHERE tenant_id = $1 AND status = 'open'
  ORDER BY started_at DESC
`, [tenantId])
```

**Frontend (`sync.js` ligne ~425):**
```javascript
const insertSession = db.prepare(`
  INSERT OR REPLACE INTO inventory_sessions 
    (name, status, started_at, ended_at, remote_uuid)
  VALUES (?, ?, ?, ?, ?)
`);

// Ne synchronise que les sessions "open" (pas l'historique complet)
if (s.status !== 'open') continue;
```

**Impact:**
- Chaque terminal voit les sessions ouvertes des autres postes
- Mapping via `remote_uuid` (UUID Neon → ID local)
- Exécuté à chaque cycle de sync (configurable)

---

### Phase 5: Comptages Multiposte (Task 6)
**Fichier modifié:**
- `caisse/src/main/handlers/inventory.js`

**Nouvel endpoint API:**
```javascript
async function apiInventoryCounts(sessionId) {
  const res = await fetch(`${API}/inventory/${sessionId}/counts`, {
    method: 'GET',
    headers: buildJsonHeaders(),
  });
  return res.json()?.counts || [];
}
```

**Handler IPC:**
```javascript
safeHandle(ipcMain, 'inventory:getCounts', async (_e, sessionId) => {
  try {
    const counts = await apiInventoryCounts(sessionId);
    return counts; // [{produit_id, device_id, user, qty, updated_at, product_name}]
  } catch (e) {
    return [];
  }
});
```

**Impact:**
- UI peut afficher les comptages par device (ex: "Terminal A: 10, Terminal B: 5")
- Agrégation automatique côté API via `SUM(qty) GROUP BY produit_id`
- Temps réel si rafraîchi toutes les 10s

---

### Phase 6: Table Résumé Locale (Task 7)
**Fichier modifié:**
- `caisse/src/main/db/schema.js` - Nouvelle table

**Nouvelle table:**
```sql
CREATE TABLE IF NOT EXISTS inventory_summary (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL,
  produit_id     INTEGER NOT NULL,
  stock_start    REAL NOT NULL DEFAULT 0,
  counted_total  REAL NOT NULL DEFAULT 0,
  delta          REAL NOT NULL DEFAULT 0,
  unit_cost      REAL NOT NULL DEFAULT 0,
  delta_value    REAL NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, produit_id)
);
```

**Impact:**
- Permet de consulter l'historique des inventaires offline
- Contient les deltas calculés (counted - stock_start)
- Peut être lié au module Historique pour affichage
- Persisté après finalisation

---

### Phase 7: Finalisation Offline Robuste (Task 8)
**Fichier modifié:**
- `caisse/src/main/handlers/inventory.js` - `inventory:finalize` handler

**Logique offline:**
```javascript
// 1) Récupérer comptages locaux
const counts = db.prepare(`
  SELECT produit_id, SUM(qty) AS counted_total
  FROM inventory_counts
  WHERE session_id = ?
  GROUP BY produit_id
`).all(sessionId);

// 2) Pour chaque produit, calculer delta
for (const p of produits) {
  const stockStart = Number(p.stock || 0);
  const counted = countsMap.get(p.id) || 0;
  const delta = counted - stockStart;
  
  // Sauvegarder dans inventory_summary
  insertSummary.run(sessionId, p.id, stockStart, counted, delta, ...);
  
  // Si delta non nul, créer stock_movement
  if (delta !== 0) {
    createStockMovement(p.id, delta, 'inventory', null, {...});
  }
}

// 3) Marquer session comme fermée
db.prepare(`UPDATE inventory_sessions SET status='closed' WHERE id = ?`).run(sessionId);
```

**Impact:**
- ✅ Finalisation possible sans connexion internet
- ✅ Stocks mis à jour immédiatement en local
- ✅ Résumé sauvegardé dans `inventory_summary`
- ✅ Op `inventory.finalize` enfilée pour sync ultérieure
- ✅ UI notifiée: "Finalisé localement (en attente sync)"

---

## 🎯 Fonctionnalités Maintenant Disponibles

### 1. **Multi-Terminal (Multiposte)**
- Plusieurs terminaux peuvent compter simultanément
- Chaque comptage identifié par `device_id`
- Agrégation automatique: `SUM(qty)` par produit
- Visualisation par device: `GET /inventory/:sessionId/counts`

### 2. **Multi-Tenant**
- Isolation complète par `tenant_id` (Neon)
- Chaque tenant voit uniquement ses sessions/comptages
- Authentification via `authRequired` middleware

### 3. **Offline-First**
- Session locale créée immédiatement même sans réseau
- Comptages persistés localement avant envoi API
- Finalisation locale avec calcul de deltas
- Sync automatique lors de reconnexion

### 4. **Event-Sourced**
- `stock_movements` créés pour chaque delta
- `inventory_snapshot` capture stock_start
- `inventory_adjust` persiste les ajustements
- Audit trail complet

### 5. **Session Management**
- Réutilisation session "open" existante (`POST /start`)
- Listing avec filtres (`GET /sessions?status=open`)
- Fermeture atomique avec locking
- Historique local dans `inventory_summary`

---

## 📊 Architecture Finale

### Backend (Neon PostgreSQL)
```
inventory_sessions (id uuid, tenant_id, name, status, started_at, ended_at)
  ↓
inventory_snapshot (session_id, produit_id, stock_start, unit_cost)
  ↓
inventory_counts (session_id, produit_id, device_id, qty) [PK: (session, produit, device)]
  ↓
inventory_adjust (session_id, produit_id, stock_start, counted_total, delta, delta_value)
  ↓
stock_movements (produit_id, delta, source='inventory', reference_id=session_id)
```

### Frontend (SQLite Local)
```
inventory_sessions (id INTEGER, remote_uuid TEXT)
  ↓
inventory_counts (session_id, produit_id, qty, device_id)
  ↓
inventory_summary (session_id, produit_id, stock_start, counted_total, delta)
  ↓
stock_movements (produit_id, delta, source='inventory')
  ↓
ops_queue (opType='inventory.finalize', payload={session_id, ...})
```

### Flux de Données
```
1. Terminal A: POST /inventory/start → session uuid ABC
2. Sync: Pull sessions → Terminal B voit session ABC
3. Terminal A: POST /inventory/ABC/count-add (device_id=A, qty=10)
4. Terminal B: POST /inventory/ABC/count-add (device_id=B, qty=5)
5. API: ON CONFLICT DO UPDATE → counted_total = 15
6. Terminal A: GET /inventory/ABC/summary → voit 15 total (10+5)
7. Terminal A: POST /inventory/ABC/finalize
   → Snapshot créé
   → Delta calculé: 15 - stock_start
   → Stock mis à jour: produits.stock = 15
   → Stock movements créés
   → Session fermée: status='closed'
8. Sync: Pull sessions → Terminal B ne voit plus session ABC
```

---

## 🧪 Tests à Effectuer

### Test 1: Multi-Terminal Counting
```bash
# Terminal A
curl POST /inventory/start → session_id: XXX

# Terminal B (après sync)
curl POST /inventory/XXX/count-add -d '{"produit_id":"...", "qty":10, "device_id":"B"}'

# Terminal A
curl POST /inventory/XXX/count-add -d '{"produit_id":"...", "qty":5, "device_id":"A"}'

# Vérifier agrégation
curl GET /inventory/XXX/summary → counted_total: 15
curl GET /inventory/XXX/counts → [{device_id:"A", qty:5}, {device_id:"B", qty:10}]
```

### Test 2: Offline Finalization
```bash
# 1. Démarrer inventaire en ligne
POST /inventory/start

# 2. Compter produits
POST /inventory/:id/count-add (plusieurs produits)

# 3. Couper réseau
# 4. Finaliser (IPC: inventory:finalize)

# Vérifier:
- inventory_sessions.status = 'closed'
- inventory_summary peuplée
- stock_movements créés
- produits.stock mis à jour
- ops_queue contient 'inventory.finalize'

# 5. Reconnecter → sync auto envoie finalize à Neon
```

### Test 3: Session Conflict
```bash
# Terminal A: Finalise session XXX
POST /inventory/XXX/finalize

# Terminal B: Essaie de finaliser (race)
POST /inventory/XXX/finalize
→ HTTP 409 {"error":"session_locked"}
```

### Test 4: Session Sync
```bash
# Terminal A: Créer session
POST /inventory/start → session_id: YYY, status: open

# Terminal B: Attendre cycle sync (ou forcer)
IPC: sync:trigger

# Vérifier dans Terminal B:
SELECT * FROM inventory_sessions WHERE remote_uuid = 'YYY'
→ Doit exister

# Terminal A: Finaliser
POST /inventory/YYY/finalize

# Terminal B: Re-sync
→ Session YYY disparaît (status != 'open')
```

---

## 🔧 Configuration Recommandée

### Sync Interval
```javascript
// src/main/sync.js
const SYNC_INTERVAL = 30000; // 30s pour sessions inventory
```

### Device ID
```javascript
// Automatique: MAC address hash
// Ou manuel: process.env.DEVICE_ID = "Terminal-A"
```

### Logs
```javascript
// Activer logs détaillés
DEBUG=inventory,sync node main.js
```

---

## 📝 Notes Importantes

### 1. **Migration Automatique**
- Les 3 migrations (cart_items, carts, inventory_counts) s'exécutent au démarrage
- Détection via `PRAGMA table_info` + parsing SQL
- Réversible si besoin (backup dans tables temporaires)

### 2. **Colonne `remote_uuid`**
- Clé de mapping UUID Neon ↔ ID local SQLite
- Utilisée pour: produits, sessions, fournisseurs, categories, unites
- Index créé automatiquement: `idx_produits_remote_uuid`

### 3. **Accumulation Comptages**
- `ON CONFLICT (session_id, produit_id, device_id) DO UPDATE SET qty = qty + EXCLUDED.qty`
- Permet de scanner le même produit plusieurs fois sans perdre les comptes précédents
- Exemple: Scanner code-barre 3 fois → qty finale = 3 (pas 1)

### 4. **Session Locking**
- Status `finalizing` bloque toute double finalisation
- Race condition gérée côté API (transaction BEGIN...COMMIT)
- Client reçoit 409 Conflict si déjà finalisée

### 5. **Stock Movements Audit**
- Chaque delta d'inventaire crée un mouvement avec `source='inventory'`
- `reference_id` = UUID de la session
- `meta` JSON contient: stock_start, counted_total, delta
- Permet reconstitution historique complète

---

## 🚀 Prochaines Étapes (Optionnel)

### 1. **UI Multiposte Visualization**
```javascript
// src/renderer/pages/inventaire.js
async function loadMultiposteCounts() {
  const counts = await window.electron.invoke('inventory:getCounts', sessionId);
  
  // Grouper par produit
  const byProduct = counts.reduce((acc, c) => {
    if (!acc[c.produit_id]) acc[c.produit_id] = [];
    acc[c.produit_id].push(c);
    return acc;
  }, {});
  
  // Afficher avec badges
  for (const [prodId, devices] of Object.entries(byProduct)) {
    const total = devices.reduce((sum, d) => sum + Number(d.qty), 0);
    const html = `
      <span class="count-total">${total}</span>
      <div class="device-breakdown">
        ${devices.map(d => `<span class="badge">${d.device_id}: ${d.qty}</span>`).join('')}
      </div>
    `;
    // Injecter dans row du produit
  }
}
```

### 2. **Auto-Refresh en Session Ouverte**
```javascript
// Rafraîchir comptages toutes les 10s si session ouverte
let refreshInterval;
if (currentSession && currentSession.status === 'open') {
  refreshInterval = setInterval(loadMultiposteCounts, 10000);
}
// Cleanup lors fermeture
window.electron.on('inventory:session-closed', () => clearInterval(refreshInterval));
```

### 3. **Historique Inventaires**
```javascript
// Lier inventory_summary au module Historique
SELECT 
  s.name, s.started_at, s.ended_at,
  SUM(sm.delta_value) AS total_value,
  COUNT(*) AS items_adjusted
FROM inventory_sessions s
JOIN inventory_summary sm ON sm.session_id = s.id
WHERE s.status = 'closed'
GROUP BY s.id
ORDER BY s.ended_at DESC
```

### 4. **Export PDF/Excel**
```javascript
// Générer rapport après finalisation
const summary = await window.electron.invoke('inventory:getSummary', sessionId);
generatePDF(summary); // Bibliothèque: pdfkit, jsPDF, etc.
```

### 5. **Notifications Push**
```javascript
// WebSocket pour notifier autres terminaux en temps réel
// Quand Terminal A finalise → Terminal B reçoit event immédiat
wss.on('inventory:finalized', (sessionId) => {
  BrowserWindow.getAllWindows().forEach(w => 
    w.webContents.send('inventory:session-closed', { sessionId })
  );
});
```

---

## ✅ Checklist Validation

- [x] Routes API unifiées (6 endpoints)
- [x] Schema Neon aligné (produit_id)
- [x] Migration FK inventory_counts
- [x] Mapping UUID standardisé (remote_uuid)
- [x] Sync sessions distantes (pullRefs)
- [x] Handler multiposte counts (IPC)
- [x] Table inventory_summary locale
- [x] Finalisation offline robuste
- [ ] Tests unitaires (optionnel)
- [ ] Tests E2E multi-terminaux (optionnel)
- [ ] UI multiposte visualization (optionnel)
- [ ] Documentation utilisateur (optionnel)

---

## 🎉 Résultat

Vous disposez maintenant d'un **système d'inventaire complet, multiposte, multitenant, avec support offline robuste et event-sourcing**. 

Toutes les modifications sont terminées et prêtes à être testées. Le système est conçu pour :
- ✅ Supporter plusieurs terminaux comptant simultanément
- ✅ Fonctionner offline avec synchronisation automatique
- ✅ Isoler les données par tenant (multitenant)
- ✅ Tracer tous les mouvements de stock (audit trail)
- ✅ Gérer les conflits et race conditions

**Prochaine étape suggérée:** Tester avec 2 terminaux (ou 2 instances Electron) sur un réseau local pour valider le comportement multiposte en conditions réelles.
