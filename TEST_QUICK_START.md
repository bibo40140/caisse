# 🚀 QUICK START - TESTER INVENTAIRE MULTIPOSTE

**Durée estimée :** 10 minutes  
**Niveau :** Facile

---

## ✅ Pré-requis Vérifiés

- ✅ API Endpoints implémentés (6 routes)
- ✅ Database table `inventory_device_status` créée + migration auto
- ✅ Client UI polling activé (3 sec)
- ✅ Handlers Electron pour mark-finished + device-status
- ✅ Auto-finalization quand tous les devices ont validé

---

## 📋 Étapes de Test

### 1️⃣ Démarrer l'API

```powershell
cd C:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse-api
npm start
```

**Vérifier dans les logs :**
```
✅ [db] Migration: table inventory_device_status vérifiée/créée
✅ Express server running on :3001
```

---

### 2️⃣ Démarrer l'Electron App

```powershell
cd C:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse
npm start
```

**Attendre que l'interface charge. Vous devriez voir les pages.**

---

### 3️⃣ TEST SCENARIO : Inventaire Solo

#### Étape A : Créer inventaire
1. Cliquer **"Inventaires"** dans le menu
2. Cliquer **"Nouvel inventaire"**
3. Entrer un nom (ex: "Test Solo 9 déc")
4. Cliquer **"Commencer l'inventaire"**

#### Étape B : Compter un produit
1. Chercher un produit (ex: "eau" ou scanner un code barre)
2. Cliquer sur un produit dans la liste
3. Entrer une quantité (ex: **15**)
4. Cliquer **"Ajouter"** ou **Entrée**

**IMPORTANT : Regarder le bouton en bas :**
- ❌ S'il dit **"J'ai terminé"** → Mode MULTI (problème)
- ✅ S'il dit **"Clôturer l'inventaire"** → Mode SOLO (correct)

#### Étape C : Finaliser
1. Cliquer **"Clôturer l'inventaire"**
2. Attendre la confirmation
3. **Vérifier le stock** :
   - Aller dans **"Produits"**
   - Chercher le produit que vous avez compté
   - Le stock doit être à **15** (la quantité que vous avez comptée)

**✅ TEST RÉUSSI** si stock = 15

---

### 4️⃣ TEST SCENARIO : Inventaire Multiposte (Bonus - Plus Complexe)

**Note :** Pour tester avec 2 devices simultanément, il faudrait :
- Option A : 2 ordinateurs différents connectés à la même API
- Option B : 2 instances Electron (possible mais complexe)
- Option C : Simuler avec DevTools (avancé)

**Pour maintenant : tester juste que le code détecte solo vs multi :**

1. Créer inventaire (Solo)
2. Vérifier que bouton = "Clôturer"
3. Finaliser
4. ✅ Stock mis à jour

---

## 🔍 Logs à Surveiller

### Dans l'app Electron (ouvrir DevTools : F12)

```javascript
// Doit afficher toutes les 3 sec:
[inventaire] Polling...
[inventaire] updateDeviceStatus()
[inventaire] total: 1, finished: 0

// Quand vous cliquez Clôturer:
[inventaire] Clôture de l'inventaire...
[inventory:finalize] OK
```

### Dans le terminal API

```
[db] Migration: table inventory_device_status vérifiée/créée
[POST /inventory/start] OK sessionId=123...
[POST /inventory/123/count-add] OK produit_id=abc...
[GET /inventory/123/device-status] total=1, allFinished=false
[POST /inventory/123/finalize] Agrégation: SUM(qty) pour 1 produit...
[db] Stock updated: Produit X → 15
```

---

## 🎯 Checklist Test

- [ ] API démarre sans erreur
- [ ] Electron se connecte à l'API
- [ ] Créer inventaire réussit
- [ ] Compter produit réussit
- [ ] Bouton affiche "Clôturer l'inventaire" (solo)
- [ ] Finaliser réussit
- [ ] Stock mis à jour correctement
- [ ] Aucune erreur dans les logs

---

## ⚠️ Troubleshooting

### API ne démarre pas
```
❌ Error: ENOENT: no such file or directory
```
→ Vérifier que vous êtes dans `caisse-api` folder
→ Vérifier que `npm install` a été exécuté

### Electron ne se connecte pas à l'API
```
❌ Cannot POST /inventory/start
```
→ Vérifier que l'API tourne sur :3001
→ Vérifier dans config.json que API_URL = "http://localhost:3001"

### Stock pas mis à jour
→ Vérifier que la session s'est bien finalisée
→ Regarder les logs de finalization
→ Vérifier que le produit comptabilité a bien été synchronisé

---

## 🎉 Résumé

Si vous voyez :
1. ✅ API démarre
2. ✅ Electron créer inventaire
3. ✅ Compter produit
4. ✅ Bouton "Clôturer"
5. ✅ Stock = quantité comptée

**ALORS TOUT FONCTIONNE !** 🚀

Les multiposte sont prêts, juste pas testés avec 2+ devices simultanément. C'est le prochain test quand vous aurez 2 terminaux.
