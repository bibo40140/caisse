# Test de Robustesse - Système de Synchronisation

## ✅ Améliorations Implémentées

### 1. Vérification Module Stocks
- ✅ **produits.js**: Mouvement initial créé seulement si `isModuleActive('stocks')` retourne true
- ✅ **ventes.js**: Déjà vérifié avec `stocksOn`
- ✅ **receptions.js**: Déjà vérifié avec `stocksOn`

### 2. Gestion d'Erreurs
- ✅ **ventes.js**: Try/catch autour de `createStockMovement` - la vente continue même si le mouvement échoue
- ✅ **receptions.js**: Try/catch autour de `createStockMovement` - la réception continue même si le mouvement échoue
- ✅ **produits.js**: Try/catch déjà présent autour du stock initial

### 3. Indicateurs Visuels de Synchronisation
- ✅ **renderer.js**: Écouteurs d'événements ajoutés
  - `sync:state` → Affiche: ⇧ (pushing), ⇣ (pulling), ✗ (offline), ✓ (online)
  - `sync:failed_limit` → Affiche: ⚠ avec toast d'erreur
- ✅ **style.css**: Classes CSS déjà présentes (.online, .offline, .syncing)
- ✅ **index.html**: Élément `#sync-indicator` déjà dans le DOM

### 4. Système de Retry (Déjà Existant)
- ✅ **sync.js**: Backoff exponentiel avec jitter basé sur `retry_count`
- ✅ Limite de retry: `MAX_RETRY_ATTEMPTS`
- ✅ Notification au renderer quand la limite est atteinte

## 🧪 Scénarios de Test

### Scénario 1: Module Stocks Désactivé
**Objectif**: Vérifier qu'aucun mouvement n'est créé

1. Éditer `config.json`: Désactiver le module stocks
2. Créer un nouveau produit avec stock initial 100
3. Vérifier dans SQLite: `SELECT * FROM stock_movements WHERE produit_id = ?`
   - **Résultat attendu**: Aucune ligne
4. Vendre 5 unités
5. Vérifier à nouveau
   - **Résultat attendu**: Aucune ligne

### Scénario 2: Module Stocks Activé
**Objectif**: Vérifier que les mouvements sont créés

1. Éditer `config.json`: Activer le module stocks
2. Créer un nouveau produit avec stock initial 50
3. Vérifier dans SQLite: `SELECT * FROM stock_movements WHERE produit_id = ?`
   - **Résultat attendu**: 1 ligne avec delta=50, source='initial'
4. Vendre 10 unités
5. Vérifier à nouveau
   - **Résultat attendu**: 2 lignes (initial + vente)

### Scénario 3: Indicateur de Synchronisation
**Objectif**: Vérifier l'affichage du statut de sync

1. Démarrer l'application avec serveur actif
2. Observer l'indicateur en haut à droite
   - **Résultat attendu**: ✓ (vert) quand en ligne et synchronisé
3. Créer une vente
4. Observer l'indicateur pendant le push
   - **Résultat attendu**: ⇧ (jaune) pendant l'envoi
5. Observer après le push
   - **Résultat attendu**: ✓ (vert) après succès

### Scénario 4: Mode Offline
**Objectif**: Vérifier le comportement hors ligne

1. Arrêter le serveur API
2. Observer l'indicateur
   - **Résultat attendu**: ✗ (rouge)
3. Créer une vente
4. Observer l'indicateur
   - **Résultat attendu**: Affiche le nombre d'opérations en attente
5. Redémarrer le serveur
6. Observer
   - **Résultat attendu**: ⇧ puis ✓ après synchronisation

### Scénario 5: Échec de Synchronisation
**Objectif**: Vérifier le retry et la notification d'erreur

1. Configurer le serveur pour retourner des erreurs 500
2. Créer plusieurs ventes
3. Attendre que le système tente plusieurs retry
4. Observer l'indicateur
   - **Résultat attendu**: ⚠ (rouge) après limite atteinte
5. Observer le toast
   - **Résultat attendu**: Message "Échec de synchronisation: X opération(s) en attente"

### Scénario 6: Erreur dans createStockMovement
**Objectif**: Vérifier que la transaction continue malgré l'erreur

1. Simuler une erreur dans `createStockMovement` (ex: corrompre la table)
2. Créer une vente
3. Vérifier que la vente est enregistrée
   - **Résultat attendu**: Vente dans la table `ventes`, erreur dans la console mais pas de crash
4. Vérifier les mouvements de stock
   - **Résultat attendu**: Aucun mouvement créé, mais la vente existe

## 📊 Métriques de Validation

- **Taux de succès**: 100% des transactions doivent réussir même si les mouvements échouent
- **Temps de recovery**: < 1 minute après retour en ligne
- **Fiabilité du retry**: Aucune perte d'opération après échec temporaire
- **UX**: Utilisateur toujours informé de l'état de synchronisation

## 🔍 Points de Contrôle Critiques

### Base de Données
```sql
-- Vérifier les mouvements
SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 10;

-- Vérifier les opérations en attente
SELECT * FROM ops_queue WHERE ack = 0;

-- Vérifier le stock calculé vs stock stocké
SELECT 
  p.id,
  p.nom,
  p.stock AS stock_stored,
  COALESCE(SUM(sm.delta), p.stock) AS stock_calculated
FROM produits p
LEFT JOIN stock_movements sm ON sm.produit_id = p.id
GROUP BY p.id;
```

### Console Développeur
- Pas d'erreurs non catchées
- Logs clairs pour debugging: `[stock]`, `[vente]`, `[reception]`, `[sync]`
- Warnings appropriés pour les états dégradés

### Interface Utilisateur
- Indicateur de sync toujours visible
- Changements d'état fluides (pas de clignotement)
- Toasts d'erreur informatifs et non intrusifs

## ✨ Prochaines Étapes (Post-Tests)

Si tous les tests passent:
1. ✅ Option 1 complète: Robustesse validée
2. 🔄 Passer à l'Option 2: Synchronisation complète ventes/réceptions entre caisses
3. 🔄 Ou Option 3: Optimisations de performance (pull incrémental)

## 🐛 Problèmes Connus à Surveiller

- **SQLite lock errors**: Si plusieurs opérations rapides en même temps
- **Memory leaks**: Dans les event listeners (déjà géré avec `removeAllListeners`)
- **Race conditions**: Entre push et pull (normalement impossible avec event sourcing)
