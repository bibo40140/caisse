/**
 * ============================================================
 * TESTS BASIQUES - Pour apprendre
 * ============================================================
 * 
 * Ces tests sont TRÈS SIMPLES pour comprendre le concept
 */

describe('🎓 Tests d\'apprentissage', () => {
  
  // ========================================
  // NIVEAU 1 : Tests mathématiques simples
  // ========================================
  describe('Niveau 1 : Mathématiques', () => {
    
    test('✅ 2 + 2 devrait égaler 4', () => {
      // C'est le test le plus simple possible !
      const resultat = 2 + 2;
      expect(resultat).toBe(4);
    });
    
    test('✅ 10 est plus grand que 5', () => {
      expect(10).toBeGreaterThan(5);
    });
    
    test('✅ 3 est plus petit que 10', () => {
      expect(3).toBeLessThan(10);
    });
  });
  
  // ========================================
  // NIVEAU 2 : Tests de chaînes de caractères
  // ========================================
  describe('Niveau 2 : Texte', () => {
    
    test('✅ Une chaîne devrait contenir un mot', () => {
      const texte = 'Bonjour le monde';
      expect(texte).toContain('monde');
    });
    
    test('✅ Une chaîne vide devrait être falsy', () => {
      const vide = '';
      expect(vide).toBeFalsy();
    });
    
    test('✅ Une chaîne non-vide devrait être truthy', () => {
      const texte = 'Hello';
      expect(texte).toBeTruthy();
    });
  });
  
  // ========================================
  // NIVEAU 3 : Tests de tableaux
  // ========================================
  describe('Niveau 3 : Tableaux', () => {
    
    test('✅ Un tableau devrait contenir un élément', () => {
      const fruits = ['pomme', 'banane', 'orange'];
      expect(fruits).toContain('banane');
    });
    
    test('✅ Un tableau devrait avoir la bonne longueur', () => {
      const nombres = [1, 2, 3, 4, 5];
      expect(nombres).toHaveLength(5);
    });
    
    test('✅ On peut filtrer un tableau', () => {
      const nombres = [1, 2, 3, 4, 5, 6];
      const pairs = nombres.filter(n => n % 2 === 0);
      
      expect(pairs).toHaveLength(3);
      expect(pairs).toEqual([2, 4, 6]);
    });
  });
  
  // ========================================
  // NIVEAU 4 : Tests d'objets
  // ========================================
  describe('Niveau 4 : Objets', () => {
    
    test('✅ Un objet devrait avoir une propriété', () => {
      const personne = {
        nom: 'Alice',
        age: 30,
      };
      
      expect(personne).toHaveProperty('nom');
      expect(personne).toHaveProperty('age');
    });
    
    test('✅ Deux objets identiques devraient être égaux', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 2 };
      
      expect(obj1).toEqual(obj2);
    });
    
    test('✅ On peut accéder aux propriétés imbriquées', () => {
      const data = {
        user: {
          name: 'Bob',
          address: {
            city: 'Paris',
          },
        },
      };
      
      expect(data.user.name).toBe('Bob');
      expect(data.user.address.city).toBe('Paris');
    });
  });
  
  // ========================================
  // NIVEAU 5 : Tests asynchrones
  // ========================================
  describe('Niveau 5 : Asynchrone', () => {
    
    test('✅ Une promesse devrait se résoudre', async () => {
      // Simule une opération asynchrone (comme un appel API)
      const promesse = Promise.resolve('Succès !');
      
      const resultat = await promesse;
      expect(resultat).toBe('Succès !');
    });
    
    test('✅ setTimeout devrait fonctionner', (done) => {
      // Test avec callback
      setTimeout(() => {
        expect(true).toBe(true);
        done(); // Dit à Jest que le test est terminé
      }, 100);
    });
  });
});

/**
 * ============================================================
 * 📚 GUIDE DE LECTURE
 * ============================================================
 * 
 * COMMENT LIRE UN TEST :
 * 
 * test('✅ 2 + 2 devrait égaler 4', () => {
 *   ↑ Nom descriptif (ce qu'on teste)
 *   
 *   const resultat = 2 + 2;
 *   ↑ On fait le calcul
 *   
 *   expect(resultat).toBe(4);
 *   ↑ On vérifie que c'est correct
 * });
 * 
 * 
 * LES SYMBOLES :
 * ✅ = Test qui devrait passer
 * ❌ = Test qui devrait échouer
 * ⏭️ = Test ignoré (.skip)
 * 🎯 = Test isolé (.only)
 * 
 * 
 * COMMANDES :
 * 
 * npm test                    → Lance tous les tests
 * npm test basics.test.js     → Lance ce fichier uniquement
 * npm run test:watch          → Relance automatiquement
 * 
 * 
 * RÉSULTATS :
 * 
 * Quand tu lances les tests, tu vois :
 * 
 * ✓ 2 + 2 devrait égaler 4 (3ms)
 * ✓ 10 est plus grand que 5 (1ms)
 * ...
 * 
 * Tests: 15 passed, 15 total
 * ↑ Tous les tests ont réussi !
 * 
 * 
 * SI UN TEST ÉCHOUE :
 * 
 * ✕ 2 + 2 devrait égaler 4 (5ms)
 * 
 * Expected: 4
 * Received: 5
 * ↑ Ce qu'on attendait vs ce qu'on a eu
 * 
 * at line 42
 * ↑ Où est l'erreur
 * 
 * 
 * ASTUCES :
 * 
 * 1. Lance UN fichier à la fois au début
 * 2. Lis le nom du test pour comprendre ce qu'il fait
 * 3. Si ça échoue, regarde "Expected" vs "Received"
 * 4. Ajoute des console.log() pour débugger
 * 
 * 
 * EXEMPLE DE DEBUG :
 * 
 * test('mon test', () => {
 *   const resultat = maFonction();
 *   
 *   console.log('📊 Résultat:', resultat);
 *   ↑ Affiche la valeur pour voir ce qui se passe
 *   
 *   expect(resultat).toBe(attendu);
 * });
 * 
 */
