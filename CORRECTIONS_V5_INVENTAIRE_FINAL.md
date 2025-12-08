# Corrections V5 - Inventaire Multiposte - ANALYSE COMPLÈTE

**Date :** 28 novembre 2025
**Version :** V5 (corrections critiques après V4)
**Statut :** ✅ Corrections appliquées - **REDÉMARRAGE REQUIS**

## 🔴 Problèmes Identifiés par l'Utilisateur

### 1. Colonnes Fournisseurs/Catégories Toujours Vides
**Symptôme :** Dans l'interface inventaire, les colonnes "Fournisseur" et "Catégorie" ne s'affichent jamais.

**Capture d'écran fournie :** Montre 3 produits avec colonnes vides pour fournisseur et catégorie.

### 2. Colonne "Autres" Toujours Vide
**Symptôme :** Malgré V4, la colonne "Autres" (💻) ne montre jamais les comptages des autres terminaux.

### 3. Stock Incohérent Après Clôture
**Symptôme (Caisse A) :** Stock incohérent après finalization
**Symptôme (Caisse B) :** Stock DOUBLÉ - affiche le double de ce qui a été compté

### 4. Logs API Sans Output V4
**Symptôme :** Les logs API ne montrent JAMAIS le message `[summary] Exemple ligne comptée` avec `device_counts`.

---

## 🔍 Analyse des Logs Fournis

### Logs API Analysés

```
[REQ] POST /inventory/cbf6fe19-ad49-45a9-a42e-3ff3166aea94/count-add
[REQ] GET /inventory/cbf6fe19-ad49-45a9-a42e-3ff3166aea94/summary
```

**Constat critique :** AUCUN log `[summary] Renvoi de X produits` ou `[summary] Exemple ligne comptée` visible.

**Conclusion :** L'API n'a **PAS** redémarré avec le code V4, donc les modifications de V4 ne sont PAS actives.

### Logs Sync Analysés

```
[sync] Exemple produit reçu: {
  nom: 'test 02 produit  nouveau',
  unite_id: '869e73c1-4ed8-41af-b41d-90b20e687631',
  categorie_id: '351e7768-5c3b-466c-aaa9-f090192fb841'
}
```

**Constat :** Les produits synchronisés depuis Neon **contiennent** `categorie_id` (et probablement `fournisseur_id`), donc les données existent côté DB.

---

## 🐛 Root Causes Identifiées

### Cause #1 : API Summary Ne Retourne Pas Fournisseur/Catégorie

**Fichier :** `caisse-api/routes/inventory.js` ligne 193

**Code original (INCORRECT) :**
```javascript
const produits = await pool.query(
  `SELECT id, nom, code_barre, code_barre, stock, prix
   FROM produits
   WHERE tenant_id = $1 AND deleted IS NOT TRUE
   ORDER BY nom`,
  [tenantId]
);
```

**Problème :** La requête ne sélectionne PAS `fournisseur_id` ni `categorie_id`.

**Impact :** Le frontend reçoit des objets produits sans ces champs → colonnes vides.

**Solution V5 :**
```javascript
const produits = await pool.query(
  `SELECT id, nom, code_barre, code_barre, stock, prix, fournisseur_id, categorie_id
   FROM produits
   WHERE tenant_id = $1 AND deleted IS NOT TRUE
   ORDER BY nom`,
  [tenantId]
);
```

Et dans l'objet retourné (ligne 207) :
```javascript
return {
  // ... autres champs ...
  fournisseur_id: p.fournisseur_id || null,
  categorie_id: p.categorie_id || null,
  device_counts: device_counts
};
```

---

### Cause #2 : Finalization Met Stock à 0 Pour Produits Non Comptés

**Fichier :** `caisse-api/routes/inventory.js` ligne 342

**Code original (INCORRECT) :**
```javascript
// TOUJOURS mettre à jour le stock (même pour les non comptés → 0)
await client.query(
  `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
  [counted, prod.id, tenantId]
);
```

**Problème CRITIQUE :**
- La boucle traite **TOUS** les produits du tenant
- Pour les produits non comptés : `counted = 0` (car `countsMap.get(prod.id)` retourne `undefined`)
- Donc `UPDATE produits SET stock = 0` pour **tous** les produits non comptés !

**Exemple concret :**
```
Produit A : stock initial = 10, compté = 5 → UPDATE stock = 5 ✅
Produit B : stock initial = 20, NON compté → UPDATE stock = 0 ❌❌❌
Produit C : stock initial = 15, NON compté → UPDATE stock = 0 ❌❌❌
```

**Conséquence :**
1. Tous les produits non inventoriés voient leur stock mis à 0
2. À la sync suivante, création de stock_movements négatifs massifs
3. Sur Terminal-B, ces movements s'appliquent → stocks incohérents
4. Si un produit était à 10 et n'a pas été compté, il passe à 0, puis à la sync suivante Terminal-B voit -10 et si son stock était 5, il passe à 5 + (-10) = -5, mais ensuite à la réinitialisation il passe à 0, puis lors d'une nouvelle sync il reçoit à nouveau les movements... **effet boule de neige**.

**Solution V5 :**
```javascript
// Créer mouvement et mettre à jour stock UNIQUEMENT pour les produits comptés
if (countsMap.has(prod.id)) {
  // Produit a été compté : créer movement si delta !== 0 et toujours mettre à jour stock
  if (delta !== 0) {
    await client.query(
      `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
       VALUES ($1, $2, $3, 'inventory', $4, NOW())`,
      [tenantId, prod.id, delta, sessionId]
    );
  }
  
  // Mettre à jour le stock avec la quantité comptée
  await client.query(
    `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
    [counted, prod.id, tenantId]
  );
}
// Si produit non compté : on ne touche PAS au stock (garde valeur actuelle)
```

**Logique corrigée :**
- **SI** produit a été compté (existe dans `countsMap`) :
  - Créer stock_movement si `delta !== 0`
  - Mettre à jour `stock = counted`
- **SINON** (produit non compté) :
  - Ne rien faire, garder le stock actuel

---

### Cause #3 : Nodemon N'a Pas Redémarré (V4 Non Actif)

**Preuve :** Aucun log `[summary]` dans les logs API fournis.

**Code V4 attendu (ligne 226-235) :**
```javascript
console.log('[summary] Renvoi de', lines.length, 'produits');
const countedLines = lines.filter(l => l.counted_total > 0);
if (countedLines.length > 0) {
  console.log('[summary] Exemple ligne comptée:', {
    nom: countedLines[0].nom,
    counted_total: countedLines[0].counted_total,
    prix: countedLines[0].prix,
    device_counts: countedLines[0].device_counts
  });
}
```

**Attendu si V4 actif :**
```
[summary] Renvoi de 3 produits
[summary] Exemple ligne comptée: {
  nom: 'test 01 produit nouveau',
  counted_total: 5,
  prix: 1.04,
  device_counts: { 'Terminal-A': 5 }
}
```

**Réel :** RIEN.

**Solution :** Forcer redémarrage manuel de l'API.

---

## ✅ Corrections Appliquées V5

### Modification #1 : Ajout fournisseur_id et categorie_id dans Summary

**Fichier :** `caisse-api/routes/inventory.js`

**Ligne 193 :** Requête SELECT enrichie
```sql
SELECT id, nom, code_barre, code_barre, stock, prix, fournisseur_id, categorie_id
FROM produits
WHERE tenant_id = $1 AND deleted IS NOT TRUE
ORDER BY nom
```

**Ligne 207 :** Objet retourné enrichi
```javascript
return {
  produit_id: p.id,
  // ... autres champs ...
  fournisseur_id: p.fournisseur_id || null,
  categorie_id: p.categorie_id || null,
  device_counts: device_counts
};
```

**Impact :** Le frontend reçoit maintenant les IDs de fournisseur et catégorie, permettant l'affichage des colonnes via le mapping `fournisseursById` et `categoriesById`.

---

### Modification #2 : Correction Finalize - Stock Uniquement Pour Produits Comptés

**Fichier :** `caisse-api/routes/inventory.js`

**Ligne 342 :** Logique corrigée avec condition `if (countsMap.has(prod.id))`

**Avant (INCORRECT) :**
```javascript
// TOUJOURS mettre à jour le stock (même pour les non comptés → 0)
await client.query(
  `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
  [counted, prod.id, tenantId]
);
```

**Après (CORRECT) :**
```javascript
if (countsMap.has(prod.id)) {
  // Produit a été compté : traiter
  if (delta !== 0) {
    await client.query(
      `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
       VALUES ($1, $2, $3, 'inventory', $4, NOW())`,
      [tenantId, prod.id, delta, sessionId]
    );
  }
  
  await client.query(
    `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
    [counted, prod.id, tenantId]
  );
}
// Si produit non compté : on ne touche PAS au stock
```

**Impact :**
- ✅ Produits comptés : stock mis à jour avec valeur comptée
- ✅ Produits non comptés : stock conservé (pas de passage à 0)
- ✅ Plus de création de stock_movements négatifs massifs
- ✅ Plus de doublement de stock sur Terminal-B

---

## 📋 Plan de Tests V5

### Test 1 : Redémarrage API et Vérification Logs

1. **Terminal API** : Arrêter nodemon (Ctrl+C)
2. **Terminal API** : Relancer `npm run dev`
3. **Vérifier** : Au prochain `GET /inventory/.../summary`, logs doivent montrer :
   ```
   [summary] Renvoi de 3 produits
   [summary] Exemple ligne comptée: { nom: '...', counted_total: X, prix: Y, device_counts: {...} }
   ```

### Test 2 : Colonnes Fournisseurs/Catégories

1. **Terminal-A** : Redémarrer Electron
2. **Terminal-A** : Aller sur page Inventaire
3. **Ouvrir F12 Console** : Vérifier logs `[inventaire] Fournisseurs chargés: X` (X > 0)
4. **Vérifier UI** : Colonnes "Fournisseur" et "Catégorie" doivent afficher les noms

**Si colonnes toujours vides :**
- Vérifier que les produits dans DB locale ont `fournisseur_id` et `categorie_id` non NULL
- Vérifier que `fournisseursById` et `categoriesById` sont bien remplis (F12 console)

### Test 3 : Colonne "Autres" (Multiposte)

**Setup :** 2 terminaux sur même session

1. **Terminal-A** : Compter 5 unités du Produit 1
2. **Attendre 5-10 secondes** (poll interval)
3. **Terminal-B** : Observer Produit 1
   - **Attendu** : Colonne "Autres" affiche `💻 5`
4. **Terminal-B** : Compter 10 unités du Produit 2
5. **Attendre 5-10 secondes**
6. **Terminal-A** : Observer Produit 2
   - **Attendu** : Colonne "Autres" affiche `💻 10`

### Test 4 : Stock Correct Après Finalization

**Setup :** Tenant avec 3 produits ayant stocks initiaux

**Stocks avant inventaire :**
- Produit A : 10
- Produit B : 20
- Produit C : 30

**Actions :**
1. **Terminal-A** : Commencer inventaire
2. **Terminal-A** : Compter Produit A = 5 (delta -5)
3. **Terminal-B** : Compter Produit B = 25 (delta +5)
4. **NE PAS compter Produit C** (tester le non-compté)
5. **Terminal-A** : Clôturer inventaire

**Résultats attendus (V5) :**
- Produit A : stock = 5 ✅ (compté)
- Produit B : stock = 25 ✅ (compté)
- Produit C : stock = 30 ✅ (NON compté, conservé)

**stock_movements créés :**
- Produit A : delta = -5 (5 - 10)
- Produit B : delta = +5 (25 - 20)
- Produit C : AUCUN movement (non compté)

### Test 5 : Pas de Doublement de Stock

1. **Terminal-B** : Après finalization, fermer et réouvrir l'app
2. **Terminal-B** : Aller sur page Produits
3. **Vérifier** : Stocks affichés = stocks attendus (pas de double)

---

## 🔄 Instructions de Déploiement

### Étape 1 : Redémarrer l'API

```powershell
# Terminal API
cd caisse-api
# Ctrl+C pour arrêter nodemon
npm run dev
```

**Vérification :** Logs doivent montrer version avec `[summary]` logs.

### Étape 2 : Redémarrer les Terminaux

```powershell
# Terminal-A
cd caisse
$env:DATA_DIR="C:\temp\caisse-A"; $env:DEVICE_ID="Terminal-A"; npm start

# Terminal-B
cd caisse
$env:DATA_DIR="C:\temp\caisse-B"; $env:DEVICE_ID="Terminal-B"; npm start
```

### Étape 3 : Nettoyer Sessions Précédentes (Optionnel)

Si vous voulez repartir sur une base propre :

```sql
-- Dans Neon Console
DELETE FROM inventory_counts WHERE session_id = 'cbf6fe19-ad49-45a9-a42e-3ff3166aea94';
DELETE FROM inventory_adjust WHERE session_id = 'cbf6fe19-ad49-45a9-a42e-3ff3166aea94';
DELETE FROM inventory_snapshot WHERE session_id = 'cbf6fe19-ad49-45a9-a42e-3ff3166aea94';
UPDATE inventory_sessions SET status = 'open' WHERE id = 'cbf6fe19-ad49-45a9-a42e-3ff3166aea94';
```

Ou créer nouvelle session :
```sql
DELETE FROM inventory_sessions WHERE tenant_id = 'a9e2067c-fd69-4715-bf02-9c6261aa646f';
```

### Étape 4 : Tests Complets

Exécuter les 5 tests documentés ci-dessus.

---

## 📊 Récapitulatif des Bugs Corrigés

| Bug | Cause | Correction | Priorité |
|-----|-------|-----------|----------|
| Colonnes Fournisseur/Catégorie vides | SELECT ne récupérait pas ces champs | Ajout `fournisseur_id, categorie_id` dans SELECT et objet retourné | 🟡 MOYENNE |
| Stock doublé/incohérent après finalization | UPDATE stock pour TOUS produits (même non comptés → 0) | UPDATE stock UNIQUEMENT si produit dans countsMap | 🔴 CRITIQUE |
| Colonne "Autres" vide | Nodemon n'a pas redémarré V4 | Forcer redémarrage API | 🟠 HAUTE |
| Pas de logs [summary] | Nodemon n'a pas redémarré V4 | Forcer redémarrage API | 🟠 HAUTE |

---

## 🎯 Prochaines Étapes

1. **Utilisateur doit redémarrer l'API** (Ctrl+C puis `npm run dev`)
2. **Utilisateur doit redémarrer les 2 terminaux Electron**
3. **Exécuter Test 1** : Vérifier logs `[summary]` apparaissent
4. **Exécuter Test 2** : Vérifier colonnes Fournisseur/Catégorie remplies
5. **Exécuter Test 3** : Vérifier colonne "Autres" fonctionne
6. **Exécuter Test 4** : Vérifier stocks corrects après finalization
7. **Exécuter Test 5** : Vérifier pas de doublement

**Si tout fonctionne :** Inventaire multiposte opérationnel ✅

**Si problèmes persistent :**
- Fournir logs API avec `[summary]` visible
- Fournir logs F12 Console du frontend
- Fournir capture d'écran de la page Produits (stocks après finalization)

---

## 📝 Notes Techniques

### Architecture Globale

```
Terminal-A (DEVICE_ID=Terminal-A)
    ↓ POST /inventory/:session/count-add { produit_id, qty: 5, device_id }
    ↓
Neon PostgreSQL (inventory_counts table)
    - session_id, produit_id, device_id, qty
    - Composite PRIMARY KEY (session_id, produit_id, device_id)
    ↓
Terminal-B (DEVICE_ID=Terminal-B)
    ↓ GET /inventory/:session/summary (poll every 5s)
    ↓ Reçoit: { lines: [{ device_counts: {'Terminal-A': 5} }] }
    ↓
Frontend calcule:
    - remoteTotal = sum(device_counts values) = 5
    - othersCounted = sum(device_counts where deviceId !== 'Terminal-B') = 5
    ↓
Affiche: "Autres: 💻 5"
```

### Finalization Flow (Corrigé V5)

```
1. Créer snapshot si absent (stock_start pour tous produits)
2. Agréger comptages: SELECT produit_id, SUM(qty) FROM inventory_counts GROUP BY produit_id
3. Pour chaque produit:
   a. SI produit in countsMap:
      - Calculer delta = counted - stock_start
      - SI delta !== 0: INSERT stock_movement
      - UPDATE produits SET stock = counted
   b. SINON (produit non compté):
      - Ne rien faire (stock conservé)
4. Sauvegarder adjustments dans inventory_adjust
5. Fermer session: UPDATE inventory_sessions SET status = 'closed'
```

### Points d'Attention

- **Polling** : Frontend rafraîchit summary toutes les 5 secondes (configurable via `cfg.inventory.poll_interval_sec`)
- **Device ID** : Doit être unique par terminal, persistant, passé dans tous les `count-add`
- **Sync** : Les stock_movements sont synchronisés entre Neon et SQLite, donc impacts sur tous les terminaux
- **Cache invalidation** : Après finalization, caches produits/stocks sont invalidés pour forcer rechargement

---

**Fin du rapport V5**
