# Multi-Poste Sync - Quick Test Guide

## Test Scenario: Complete Data Sync After DB Reset

**Estimated Duration:** 10 minutes  
**Required:** Electron app + API server + Neon DB (all running)

---

## Step 1: Initial Setup (2 min)

1. **Start Electron app**
   ```bash
   cd caisse
   npm start
   ```

2. **Login** with valid credentials
   - Should see: "Pull complet terminé" in console logs
   - Confirms `pullAll()` is running on login

3. **Verify API endpoint working**
   - Open DevTools (F12)
   - Console should show: `[sync] pullRefs`, `[sync] pullVentes`, `[sync] pullReceptions`

---

## Step 2: Create Test Data (3 min)

1. **Import Products** (via Excel if available)
   - OR create 2-3 products manually via UI
   - Wait for background sync (auto-sync every 10s)
   - Check console: Should see "product.created" enqueued

2. **Create Sale with Cotisation** (if module enabled)
   - Navigate to: Caisse → Sell to member
   - Add 1-2 products to cart
   - Complete sale (should prompt for cotisation if adherent)
   - Click validate
   - Console should show:
     ```
     sale.created enqueued
     sale.line_added enqueued
     ```

3. **Verify Sync to Server**
   - Wait 15s for auto-push
   - Console shows: `push_ops: 3 operations sent`
   - Check Neon DB (if accessible):
     ```sql
     SELECT COUNT(*) FROM ventes WHERE tenant_id = ?;
     SELECT COUNT(*) FROM produits WHERE tenant_id = ?;
     ```

---

## Step 3: Delete Local Database (2 min)

1. **Close Electron app** (gracefully)

2. **Delete SQLite database**
   ```bash
   rm caisse/coopaz.db
   # OR
   node caisse/reset-local.js
   ```

3. **Verify deletion**
   ```bash
   ls -la caisse/coopaz.db  # Should not exist
   ```

---

## Step 4: Restart and Verify Restoration (3 min)

1. **Restart Electron app**
   ```bash
   npm start
   ```

2. **Watch Console Logs** for:
   ```
   [auth:login] Pull automatique COMPLET des données depuis serveur...
   [sync] pullAll: début synchronisation complète
   [sync] pullRefs: ...
   [sync] pullVentes: ...
   [sync] pullReceptions: ...
   [sync] ${X} produits importés/mis à jour
   [sync] ${Y} vente(s) reçue(s)
   [sync] ${Z} réception(s) reçue(s)
   [sync] pullAll: synchronisation complète terminée
   ```

3. **Check UI - Verify Data Restored**

   **✅ Products Page:**
   - All imported products visible
   - Stock levels correct (recalculated from movements)
   - Prices intact

   **✅ History/Sales Page** (if available):
   - All previous sales showing
   - Sale totals correct
   - **Cotisations visible** (key test!) ⭐

   **✅ Receptions Page** (if module enabled):
   - All previous receptions showing
   - Quantities correct
   - Supplier info intact

   **✅ Stock Movements:**
   - Should show: init movement + sale lines + receptions
   - Total stock = sum of all movements

---

## Step 5: Verify Multi-Device Consistency (Optional)

If you have 2 Electron instances on same tenant:

1. **Device A:** Create new product + sale
2. **Wait 15s** (for auto-push)
3. **Device B:** Force refresh (click sync chip)
   - Should immediately see Device A's new product ✅
   - Should immediately see Device A's new sale ✅

---

## Success Criteria ✅

All of the following must be true:

- [ ] Products restored after DB delete
- [ ] Sales restored with correct amounts
- [ ] **Cotisations restored** ⭐ (Main test!)
- [ ] Stock levels recalculated correctly
- [ ] Receptions restored with quantities
- [ ] Console shows `pullAll()` completing without errors
- [ ] No data missing after restart
- [ ] UI refreshes automatically with restored data

---

## Troubleshooting

### Console shows "pull_ventes 0 ventes"
**Problem:** No sales being returned  
**Check:**
1. Verify sale was created before DB delete
2. Verify `sale.created` was enqueued (check `ops_queue` table before delete)
3. Check Neon: `SELECT COUNT(*) FROM ventes WHERE tenant_id = ?`

### Cotisations are NULL after restore
**Problem:** Cotisation column not included in SELECT  
**Check:**
1. Verify server.js line ~1106 includes `cotisation` column ✅
2. Check console: `SELECT id, cotisation FROM ventes` before/after delete
3. Restart API server if changed

### Products have wrong stock after restore
**Problem:** Stock movements not recalculated  
**Check:**
1. Verify stock_movements were pulled (console shows count)
2. Check `produits.stock` = `SUM(stock_movements.delta)` for each product
3. Verify no "sale_line" movements created during recovery

### Auto-sync not pulling every 10s
**Problem:** Auto-sync only pushes, not pulling  
**Check:**
1. Verify sync.js line ~1461 calls `pullAll()` in `runPullCycle` ✅
2. Check console timestamps of pull events
3. Verify no errors preventing pull cycle from restarting

---

## Log Markers to Search For

Successful multi-poste sync will show these in order:

```
✅ [auth:login] Pull automatique COMPLET
✅ [sync] pullAll: début
✅ [sync] pullRefs: 
✅ [sync] pullVentes: 
✅ [sync] pullReceptions: 
✅ [sync] pull: X produits importés
✅ [sync] pull: Y vente(s) reçue(s)
✅ [sync] pull: Z réception(s) reçue(s)
✅ [sync] ${N} stocks recalculés
✅ [sync] pullAll: synchronisation complète terminée
```

If you see this sequence, multi-poste sync is working ✅

---

## Performance Notes

- **First pull after login:** 2-5 seconds (depends on data size)
- **Auto-pull every 10s:** 1-2 seconds
- **Network data per pull:** ~10-20KB (with 1000-item limit)

This is acceptable overhead for data protection.

---

## Files to Inspect (for debugging)

If tests fail, check these files:

1. **caisse-api/server.js** (line ~1106)
   - Verify `cotisation` in pull_ventes SELECT ✅

2. **caisse/main.js** (line ~376)
   - Verify login calls `sync.pullAll()` ✅

3. **caisse/src/main/sync.js**
   - Line ~1461: `runPullCycle()` calls `pullAll()` ✅
   - Line ~1664: `hydrateOnStartup()` calls `pullAll()` ✅

---

**Ready to test! Good luck! 🚀**
