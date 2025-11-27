/**
 * ============================================================
 * MONITORING DE PERFORMANCE
 * ============================================================
 * 
 * Collecte et log des métriques de performance pour identifier les bottlenecks
 */

const metrics = {
  requests: {
    total: 0,
    byEndpoint: new Map(),
    byStatus: new Map(),
  },
  performance: {
    slow: [], // Requêtes lentes (>1s)
    fast: 0,  // Requêtes rapides (<100ms)
  },
  bandwidth: {
    sentBytes: 0,
    receivedBytes: 0,
  },
};

/**
 * Middleware de monitoring des performances
 */
function performanceMiddleware(req, res, next) {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Intercepter res.send pour mesurer la taille
  res.send = function(data) {
    const size = Buffer.byteLength(data || '');
    metrics.bandwidth.sentBytes += size;
    res.set('X-Response-Size', size);
    return originalSend.call(this, data);
  };
  
  // Intercepter res.json pour mesurer la taille
  res.json = function(data) {
    const json = JSON.stringify(data);
    const size = Buffer.byteLength(json);
    metrics.bandwidth.sentBytes += size;
    res.set('X-Response-Size', size);
    return originalJson.call(this, data);
  };
  
  // Mesurer la taille de la requête
  const reqSize = parseInt(req.get('content-length')) || 0;
  metrics.bandwidth.receivedBytes += reqSize;
  
  // Quand la réponse est terminée
  res.on('finish', () => {
    const elapsed = Date.now() - startTime;
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    const status = res.statusCode;
    
    // Compter les requêtes
    metrics.requests.total++;
    
    // Par endpoint
    const endpointCount = metrics.requests.byEndpoint.get(endpoint) || { count: 0, totalTime: 0 };
    endpointCount.count++;
    endpointCount.totalTime += elapsed;
    metrics.requests.byEndpoint.set(endpoint, endpointCount);
    
    // Par status
    const statusCount = metrics.requests.byStatus.get(status) || 0;
    metrics.requests.byStatus.set(status, statusCount + 1);
    
    // Performance
    if (elapsed > 1000) {
      // Requête lente
      metrics.performance.slow.push({
        endpoint,
        elapsed,
        timestamp: new Date().toISOString(),
        status,
        size: res.get('X-Response-Size') || 0,
      });
      
      // Garder seulement les 50 dernières requêtes lentes
      if (metrics.performance.slow.length > 50) {
        metrics.performance.slow.shift();
      }
      
      console.warn(`⚠️  [PERF] Requête lente: ${endpoint} ${elapsed}ms`);
    } else if (elapsed < 100) {
      metrics.performance.fast++;
    }
    
    // Logger toutes les requêtes de sync avec leur temps
    if (endpoint.includes('/sync/')) {
      console.log(`📊 [PERF] ${endpoint} ${elapsed}ms (${status})`);
    }
  });
  
  next();
}

/**
 * Obtenir les statistiques de performance
 */
function getStats() {
  const endpointStats = Array.from(metrics.requests.byEndpoint.entries()).map(([endpoint, data]) => ({
    endpoint,
    count: data.count,
    avgTime: Math.round(data.totalTime / data.count),
    totalTime: data.totalTime,
  })).sort((a, b) => b.totalTime - a.totalTime);
  
  return {
    requests: {
      total: metrics.requests.total,
      byStatus: Object.fromEntries(metrics.requests.byStatus),
      byEndpoint: endpointStats,
    },
    performance: {
      slow: metrics.performance.slow,
      slowCount: metrics.performance.slow.length,
      fastCount: metrics.performance.fast,
    },
    bandwidth: {
      sent: formatBytes(metrics.bandwidth.sentBytes),
      received: formatBytes(metrics.bandwidth.receivedBytes),
      total: formatBytes(metrics.bandwidth.sentBytes + metrics.bandwidth.receivedBytes),
    },
  };
}

/**
 * Formater les bytes en KB, MB, GB
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Réinitialiser les métriques
 */
function reset() {
  metrics.requests.total = 0;
  metrics.requests.byEndpoint.clear();
  metrics.requests.byStatus.clear();
  metrics.performance.slow = [];
  metrics.performance.fast = 0;
  metrics.bandwidth.sentBytes = 0;
  metrics.bandwidth.receivedBytes = 0;
  console.log('📊 [PERF] Métriques réinitialisées');
}

/**
 * Logger un rapport périodique des performances
 */
function startPeriodicReport(intervalMs = 5 * 60 * 1000) {
  setInterval(() => {
    const stats = getStats();
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 RAPPORT DE PERFORMANCE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Total requêtes: ${stats.requests.total}`);
    console.log(`Requêtes lentes (>1s): ${stats.performance.slowCount}`);
    console.log(`Requêtes rapides (<100ms): ${stats.performance.fastCount}`);
    console.log(`Bande passante: ↓ ${stats.bandwidth.received} | ↑ ${stats.bandwidth.sent}`);
    
    if (stats.requests.byEndpoint.length > 0) {
      console.log('\nTop 5 endpoints les plus lents:');
      stats.requests.byEndpoint.slice(0, 5).forEach((ep, i) => {
        console.log(`  ${i + 1}. ${ep.endpoint} - ${ep.avgTime}ms moy (${ep.count} requêtes)`);
      });
    }
    
    if (stats.performance.slow.length > 0) {
      console.log('\nDernières requêtes lentes:');
      stats.performance.slow.slice(-5).forEach(req => {
        console.log(`  ${req.endpoint} - ${req.elapsed}ms (${req.timestamp})`);
      });
    }
    
    console.log('═══════════════════════════════════════════════════════\n');
  }, intervalMs);
}

export {
  performanceMiddleware,
  getStats,
  reset,
  startPeriodicReport,
};
