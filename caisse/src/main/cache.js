/**
 * ============================================================
 * SYSTÈME DE CACHE CLIENT
 * ============================================================
 * 
 * Cache intelligent pour réduire les appels API répétés
 * - Produits, catégories, modes de paiement, etc.
 * - TTL (Time To Live) configurable
 * - Invalidation automatique
 */

// Configuration du cache
const CACHE_CONFIG = {
  // Durée de vie par type de données (en millisecondes)
  TTL: {
    produits: 5 * 60 * 1000,        // 5 minutes
    categories: 30 * 60 * 1000,     // 30 minutes
    modes_paiement: 60 * 60 * 1000, // 1 heure
    fournisseurs: 30 * 60 * 1000,   // 30 minutes
    adherents: 10 * 60 * 1000,      // 10 minutes
  },
  
  // Taille max du cache (nombre d'entrées)
  MAX_ENTRIES: 1000,
};

// Structure du cache en mémoire
const cache = new Map();

/**
 * Entrée de cache avec métadonnées
 */
class CacheEntry {
  constructor(key, data, ttl) {
    this.key = key;
    this.data = data;
    this.timestamp = Date.now();
    this.ttl = ttl;
    this.hits = 0;
  }
  
  isExpired() {
    return Date.now() - this.timestamp > this.ttl;
  }
  
  hit() {
    this.hits++;
  }
}

/**
 * Récupérer une valeur du cache
 * @param {string} key - Clé du cache
 * @returns {any|null} - Données ou null si expiré/inexistant
 */
function get(key) {
  const entry = cache.get(key);
  
  if (!entry) {
    return null;
  }
  
  if (entry.isExpired()) {
    cache.delete(key);
    console.log(`[cache] ⏱️ Expiré: ${key}`);
    return null;
  }
  
  entry.hit();
  console.log(`[cache] ✅ Hit: ${key} (${entry.hits} accès)`);
  return entry.data;
}

/**
 * Stocker une valeur dans le cache
 * @param {string} key - Clé du cache
 * @param {any} data - Données à cacher
 * @param {number} ttl - Durée de vie en ms (optionnel)
 */
function set(key, data, ttl = 5 * 60 * 1000) {
  // Nettoyer le cache si trop plein
  if (cache.size >= CACHE_CONFIG.MAX_ENTRIES) {
    cleanOldest();
  }
  
  const entry = new CacheEntry(key, data, ttl);
  cache.set(key, entry);
  console.log(`[cache] 💾 Stocké: ${key} (TTL: ${ttl / 1000}s)`);
}

/**
 * Invalider une entrée du cache
 * @param {string} key - Clé à invalider
 */
function invalidate(key) {
  const deleted = cache.delete(key);
  if (deleted) {
    console.log(`[cache] 🗑️ Invalidé: ${key}`);
  }
  return deleted;
}

/**
 * Invalider toutes les entrées d'un type
 * @param {string} prefix - Préfixe du type (ex: 'produits:')
 */
function invalidateByPrefix(prefix) {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  // Log supprimé pour réduire le bruit
  return count;
}

/**
 * Vider tout le cache
 */
function clear() {
  const size = cache.size;
  cache.clear();
  console.log(`[cache] 🧹 Cache vidé (${size} entrées)`);
}

/**
 * Nettoyer les entrées les plus anciennes (LRU-like)
 */
function cleanOldest() {
  const entries = Array.from(cache.entries());
  
  // Trier par nombre d'accès (garder les plus utilisées)
  entries.sort((a, b) => a[1].hits - b[1].hits);
  
  // Supprimer 10% des moins utilisées
  const toRemove = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < toRemove; i++) {
    cache.delete(entries[i][0]);
  }
  
  console.log(`[cache] 🧹 Nettoyé ${toRemove} entrées anciennes`);
}

/**
 * Obtenir les statistiques du cache
 */
function getStats() {
  const entries = Array.from(cache.values());
  
  return {
    size: cache.size,
    maxSize: CACHE_CONFIG.MAX_ENTRIES,
    totalHits: entries.reduce((sum, e) => sum + e.hits, 0),
    expired: entries.filter(e => e.isExpired()).length,
    byType: getTypeStats(entries),
  };
}

/**
 * Stats par type de données
 */
function getTypeStats(entries) {
  const stats = {};
  
  for (const entry of entries) {
    const type = entry.key.split(':')[0];
    if (!stats[type]) {
      stats[type] = { count: 0, hits: 0 };
    }
    stats[type].count++;
    stats[type].hits += entry.hits;
  }
  
  return stats;
}

/**
 * ============================================================
 * HELPERS SPÉCIFIQUES PAR TYPE
 * ============================================================
 */

/**
 * Cache pour la liste des produits
 */
async function getProduits(fetchFn) {
  const key = 'produits:list';
  const cached = get(key);
  
  if (cached) {
    return cached;
  }
  
  console.log('[cache] ❌ Miss: produits - Fetch depuis API...');
  const data = await fetchFn();
  set(key, data, CACHE_CONFIG.TTL.produits);
  
  return data;
}

/**
 * Cache pour un produit spécifique
 */
async function getProduit(id, fetchFn) {
  const key = `produits:${id}`;
  const cached = get(key);
  
  if (cached) {
    return cached;
  }
  
  console.log(`[cache] ❌ Miss: produit ${id} - Fetch depuis API...`);
  const data = await fetchFn(id);
  set(key, data, CACHE_CONFIG.TTL.produits);
  
  return data;
}

/**
 * Cache pour les catégories
 */
async function getCategories(fetchFn) {
  const key = 'categories:list';
  const cached = get(key);
  
  if (cached) {
    return cached;
  }
  
  console.log('[cache] ❌ Miss: categories - Fetch depuis API...');
  const data = await fetchFn();
  set(key, data, CACHE_CONFIG.TTL.categories);
  
  return data;
}

/**
 * Cache pour les modes de paiement
 */
async function getModesPaiement(fetchFn) {
  const key = 'modes_paiement:list';
  const cached = get(key);
  
  if (cached) {
    return cached;
  }
  
  console.log('[cache] ❌ Miss: modes_paiement - Fetch depuis API...');
  const data = await fetchFn();
  set(key, data, CACHE_CONFIG.TTL.modes_paiement);
  
  return data;
}

/**
 * Invalider le cache après une modification
 */
function invalidateAfterMutation(type, id = null) {
  if (id) {
    // Invalider une entrée spécifique
    invalidate(`${type}:${id}`);
  }
  
  // Invalider aussi la liste complète
  invalidate(`${type}:list`);
  
  console.log(`[cache] 🔄 Cache invalidé après mutation: ${type}${id ? ` (id: ${id})` : ''}`);
}

/**
 * ============================================================
 * EXPORT
 * ============================================================
 */
module.exports = {
  // Fonctions de base
  get,
  set,
  invalidate,
  invalidateByPrefix,
  clear,
  getStats,
  
  // Helpers spécifiques
  getProduits,
  getProduit,
  getCategories,
  getModesPaiement,
  invalidateAfterMutation,
  
  // Configuration
  CACHE_CONFIG,
};
