# 🧪 GUIDE DES TESTS UNITAIRES - Pour Débutants

## 📚 C'est quoi un test ?

Un test unitaire, c'est comme vérifier que ta voiture démarre avant de partir en voyage. Tu vérifies que chaque partie fonctionne correctement **avant** de l'utiliser en production.

### Exemple concret :
```javascript
// Ta fonction
function additionner(a, b) {
  return a + b;
}

// Ton test
test('additionner 2 + 3 devrait donner 5', () => {
  const resultat = additionner(2, 3);
  expect(resultat).toBe(5); // ✅ Passe
});
```

---

## 🚀 Comment lancer les tests ?

### Option 1 : Lancer TOUS les tests une fois
```bash
cd caisse-api
npm test
```

### Option 2 : Mode WATCH (relance automatique)
```bash
cd caisse-api
npm run test:watch
```
☝️ **Recommandé pour développer** : les tests se relancent automatiquement quand tu modifies un fichier !

### Option 3 : Lancer UN seul fichier de test
```bash
npm test sync.test.js
```

---

## 📊 Comprendre les résultats

### ✅ Test qui PASSE (vert)
```
 PASS  __tests__/sync.test.js
  ✓ Devrait retourner une liste de ventes (45ms)
```
**Signification** : Tout fonctionne ! 🎉

### ❌ Test qui ÉCHOUE (rouge)
```
 FAIL  __tests__/sync.test.js
  ✕ Devrait retourner une liste de ventes (12ms)
  
  Expected: 200
  Received: 500
```
**Signification** : Il y a un problème à corriger 🔧

### Résumé final :
```
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        2.5s
```
- **Test Suites** : Nombre de fichiers de tests
- **Tests** : Nombre de tests individuels

---

## 🎯 Structure d'un test

Tous les tests suivent le même modèle **AAA** :

```javascript
test('Description de ce que je teste', () => {
  // 1️⃣ ARRANGE (Préparer)
  const donnees = { nom: 'Test' };
  
  // 2️⃣ ACT (Agir)
  const resultat = maFonction(donnees);
  
  // 3️⃣ ASSERT (Vérifier)
  expect(resultat).toBe(valeurAttendue);
});
```

### Exemple réel :
```javascript
test('Le pull de ventes devrait retourner un tableau', async () => {
  // ARRANGE : Je prépare ma requête
  const endpoint = '/sync/pull_ventes';
  
  // ACT : J'appelle l'API
  const response = await request(app).get(endpoint);
  
  // ASSERT : Je vérifie que ça a marché
  expect(response.status).toBe(200);
  expect(response.body.data.ventes).toBeInstanceOf(Array);
});
```

---

## 🔍 Les principaux "Matchers" (vérifications)

### Égalité
```javascript
expect(2 + 2).toBe(4);           // Égalité stricte
expect({ a: 1 }).toEqual({ a: 1 }); // Égalité d'objets
```

### Véracité
```javascript
expect(true).toBeTruthy();       // Vrai
expect(false).toBeFalsy();       // Faux
expect(null).toBeNull();         // Null
expect(undefined).toBeUndefined(); // Undefined
```

### Nombres
```javascript
expect(10).toBeGreaterThan(5);   // > 5
expect(3).toBeLessThan(10);      // < 10
```

### Tableaux et objets
```javascript
expect([1, 2, 3]).toContain(2);  // Contient 2
expect({ nom: 'John' }).toHaveProperty('nom'); // A la propriété 'nom'
```

### Erreurs
```javascript
expect(() => maFonction()).toThrow(); // Lance une erreur
```

---

## 📁 Organisation des tests

```
caisse-api/
├── __tests__/          👈 Tous les tests ici
│   ├── sync.test.js   (Tests de synchronisation)
│   ├── ventes.test.js (Tests des ventes)
│   └── ...
├── routes/             (Code à tester)
├── jest.config.js      (Configuration Jest)
└── package.json
```

---

## 🎨 Bonnes pratiques

### ✅ À FAIRE

1. **Nom descriptif** : Le nom du test doit expliquer ce qu'on teste
   ```javascript
   ✅ test('Devrait retourner 404 si la vente n\'existe pas')
   ❌ test('test1')
   ```

2. **Un test = une vérification** : Ne teste qu'une seule chose
   ```javascript
   ✅ test('Le statut doit être 200')
   ✅ test('La réponse doit contenir des ventes')
   ❌ test('Tout doit marcher') // Trop vague !
   ```

3. **Arrange-Act-Assert** : Toujours cette structure
   ```javascript
   test('exemple', () => {
     // ARRANGE
     const data = prepareData();
     
     // ACT
     const result = doSomething(data);
     
     // ASSERT
     expect(result).toBe(expected);
   });
   ```

### ❌ À ÉVITER

- ❌ Tests qui dépendent les uns des autres
- ❌ Tests qui modifient la vraie base de données
- ❌ Tests trop longs (> 100 lignes)
- ❌ Tests sans assertions (expect)

---

## 🐛 Déboguer un test qui échoue

### 1. Lire le message d'erreur
```
Expected: 200
Received: 500

at line 45
```
👆 Regarde la ligne 45 de ton test

### 2. Ajouter des console.log
```javascript
test('mon test', () => {
  const result = maFonction();
  console.log('📊 Résultat:', result); // Affiche la valeur
  expect(result).toBe(5);
});
```

### 3. Utiliser .only pour isoler
```javascript
test.only('Ce test uniquement', () => {
  // Seul ce test sera lancé
});
```

### 4. Skip un test temporairement
```javascript
test.skip('À corriger plus tard', () => {
  // Ce test ne sera pas lancé
});
```

---

## 📈 Coverage (Couverture de code)

Pour savoir quel % de ton code est testé :

```bash
npm test -- --coverage
```

Résultat :
```
File         | % Stmts | % Branch | % Funcs | % Lines
-------------|---------|----------|---------|--------
sync.js      |   85.5  |   70.0   |   90.0  |   84.2
ventes.js    |   92.3  |   80.5   |   95.0  |   91.8
```

**Objectif** : Viser 80%+ de couverture

---

## 🎯 Exercice pratique

Essaie de créer ton premier test :

```javascript
// Dans __tests__/montest.test.js

test('Mon premier test', () => {
  // ARRANGE
  const a = 2;
  const b = 3;
  
  // ACT
  const resultat = a + b;
  
  // ASSERT
  expect(resultat).toBe(5);
});
```

Lance-le :
```bash
npm test montest.test.js
```

---

## 📞 Aide supplémentaire

### Documentation Jest
- https://jestjs.io/docs/getting-started

### Si un test échoue
1. Lis le message d'erreur en entier
2. Regarde quelle ligne pose problème
3. Ajoute des `console.log()` pour voir les valeurs
4. Compare "Expected" vs "Received"

### Commandes utiles
```bash
# Lancer tous les tests
npm test

# Mode watch (relance auto)
npm run test:watch

# Un seul fichier
npm test sync.test.js

# Avec coverage
npm test -- --coverage

# Mode verbeux (+ de détails)
npm test -- --verbose
```

---

## 💡 Pourquoi tester ?

1. **Confiance** : Tu sais que ton code marche
2. **Régression** : Si tu casses quelque chose, tu le sais immédiatement
3. **Documentation** : Les tests montrent comment utiliser ton code
4. **Refactoring** : Tu peux modifier ton code en toute sécurité

---

## ✨ En résumé

1. **Un test = une vérification simple**
2. **Arrange-Act-Assert** = structure standard
3. **expect() = vérification**
4. **npm test = lancer les tests**
5. **Vert ✅ = bon, Rouge ❌ = à corriger**

**C'est comme apprendre à conduire** : Au début c'est bizarre, puis ça devient naturel ! 🚗
