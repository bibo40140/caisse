# 📋 INVENTAIRE MULTIPOSTE - Guide et Architecture

## ✅ État Actuel

L'API supporte déjà l'inventaire multiposte avec :
- **Sessions d'inventaire** (`inventory_sessions`) - Une session par inventaire
- **Comptages par device** (`inventory_counts`) - Agrégation multi-poste
- **Statut des devices** (`inventory_device_status`) - Tracking qui a compté/validé
- **Snapshots et ajustements** (`inventory_snapshot`, `inventory_adjust`)

## 🏗️ Architecture Proposée

### 1. **Flow Standard (1 poste)**
```
POST /inventory/start → sessionId
POST /inventory/sessionId/count-add → ajouter comptage
POST /inventory/sessionId/finalize → clôturer + créer movements
```

### 2. **Flow Multiposte (N postes)**
```
POST /inventory/start → sessionId
  ├─ Device A: POST /inventory/sessionId/count-add (produit 1: 10)
  ├─ Device B: POST /inventory/sessionId/count-add (produit 2: 5)
  ├─ Device A: POST /inventory/sessionId/mark-finished
  ├─ Device B: POST /inventory/sessionId/mark-finished
  └─ Device A/B: POST /inventory/sessionId/finalize (une fois tous "finished")
```

### 3. **Synchronisation en Temps Réel**

Les devices doivent interroger régulièrement (toutes les 2-5 sec) :
```
GET /inventory/sessionId/device-status
```

Réponse :
```json
{
  "total": 2,
  "finished": 1,
  "allFinished": false,
  "devices": [
    { "device_id": "pos-01", "status": "finished", "last_count_at": "..." },
    { "device_id": "pos-02", "status": "counting", "last_count_at": "..." }
  ]
}
```

## 🎯 Recommandations Implémentation UI

### 1. **Afficher l'État Multiposte**
```javascript
// Afficher au-dessus du tableau de produits:
"📱 Device ID: pos-01 | 👥 Autres postes: 1 | ✅ Validé: 1/2"
```

### 2. **Indiquer Qui a Compté Quoi**
```
Dans le tableau des produits, ajouter colonne "Compté par":
Produit 1 | 10 | pos-01 ✓ | pos-02 ✗ | Montant: 50€
Produit 2 | 5  | pos-02 ✓ | pos-01 ✗ | Montant: 25€
```

### 3. **Gestion des Boutons**

| État | Bouton | Action |
|------|--------|--------|
| 1 seul poste actif | "Clôturer l'inventaire" | `POST /finalize` direct |
| N postes actifs, en comptage | "Valider mon comptage" | `POST /mark-finished` |
| N postes actifs, tous validés | "Clôturer l'inventaire" | `POST /finalize` |
| N postes actifs, quelques non-validés | Disabled | Attendre |

### 4. **Polling/WebSocket Optimal**

**Option A : Polling simple (recommandé pour éviter websocket)**
```javascript
const pollDeviceStatus = async () => {
  const res = await fetch(`/inventory/${sessionId}/device-status`);
  const { total, finished, allFinished, devices } = await res.json();
  
  // Rafraîchir UI avec counts
  updateUIMultiposteStatus(devices);
  
  // Si tous terminés, activer bouton finalize
  if (allFinished) enableFinalizeButton();
};

setInterval(pollDeviceStatus, 3000); // Toutes les 3 sec
```

**Option B : WebSocket en temps réel**
```javascript
ws.on('inventory-device-status', (data) => {
  // Reçoit les updates en temps réel
  updateUIMultiposteStatus(data);
});
```

## ⚡ Optimisations Possibles

### 1. **WebSocket Natif (vs Polling)**
- **Avantage** : Temps réel, moins de requêtes
- **Inconvénient** : Complexité serveur + gestion des déconnexions
- **Recommandation** : Polling suffisant pour inventaire (n'est pas real-time critique)

### 2. **Broadcasting des Comptages**
- Envoyer les comptages en temps réel aux autres postes
- Permet de voir qui compte quoi PENDANT l'inventaire
- Nécessite WebSocket ou Server-Sent Events

### 3. **Vérification d'Intégrité**
```sql
-- Trigger pour vérifier les comptages avant finalisation
CREATE TRIGGER check_inventory_complete BEFORE UPDATE ON inventory_sessions
  WHEN NEW.status = 'finalizing'
  EXECUTE FUNCTION validate_all_devices_counted();
```

### 4. **Gestion des Déconnexions**
```
- Si un device se déconnecte après avoir marqué finished, garder son statut
- Si un device se reconnecte, lui permettre d'ajouter des comptages si session open
- Timeout : si device inactif >10min, le marquer comme offline
```

## 🔧 Tests Recommandés

```bash
# Test 1 : Single device
curl -X POST http://localhost:3001/inventory/start -H "x-device-id: pos-01"
curl -X POST http://localhost:3001/inventory/{id}/count-add -d '{"produit_id":"...", "qty":10, "device_id":"pos-01"}'
curl -X POST http://localhost:3001/inventory/{id}/finalize

# Test 2 : Multi device
# Device A
curl -X POST .../count-add -d '{"produit_id":"...", "qty":10, "device_id":"pos-01"}'
curl -X POST .../mark-finished -d '{"device_id":"pos-01"}'

# Device B
curl -X POST .../count-add -d '{"produit_id":"...", "qty":5, "device_id":"pos-02"}'
curl -X POST .../mark-finished -d '{"device_id":"pos-02"}'

# Check status
curl http://localhost:3001/inventory/{id}/device-status
# { "allFinished": true }

# Finalize
curl -X POST http://localhost:3001/inventory/{id}/finalize
```

## 📊 Schéma de Données

```sql
-- Session d'inventaire
inventory_sessions {
  id: uuid,
  tenant_id: uuid,
  name: text,
  status: 'open' | 'finalizing' | 'closed',
  started_at: timestamp,
  ended_at: timestamp?
}

-- Comptages par device
inventory_counts {
  session_id: uuid,
  produit_id: uuid,
  device_id: text,
  qty: numeric,
  user: text?,
  updated_at: timestamp
}

-- Statut des devices
inventory_device_status {
  session_id: uuid,
  device_id: text,
  status: 'counting' | 'finished',
  last_activity: timestamp,
  finished_at: timestamp?
}
```

## ✨ Prochaines Étapes

1. ✅ Implémenter polling côté client (`/device-status`)
2. ✅ Ajouter colonne "Compté par" dans le tableau de produits
3. ✅ Afficher indicateur "X postes connectés" + leur statut
4. ✅ Adapter logique boutons (Valider vs Clôturer)
5. 🔄 (Optionnel) WebSocket pour vrai temps réel
6. 🔄 (Optionnel) Push notifications quand tous les postes sont validés
