// src/main/logger.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../db');

// Ensure DATA_DIR exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('[logger] Failed to create DATA_DIR:', e);
}

const LOG_FILE = path.join(DATA_DIR, 'sync.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_LOGS_IN_MEMORY = 1000;

let logsBuffer = [];

/**
 * Écrit un log dans le fichier et en mémoire
 */
function log(level, category, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    category,
    message,
    data: data ? JSON.stringify(data) : null,
  };

  // Ajouter au buffer en mémoire
  logsBuffer.push(logEntry);
  if (logsBuffer.length > MAX_LOGS_IN_MEMORY) {
    logsBuffer.shift(); // Supprimer le plus ancien
  }

  // Formater pour le fichier
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;

  // Console (pour debug)
  if (level === 'ERROR') {
    console.error(`[${category}]`, message, data || '');
  } else if (level === 'WARN') {
    console.warn(`[${category}]`, message, data || '');
  } else {
    console.log(`[${category}]`, message, data || '');
  }

  // Écrire dans le fichier (asynchrone, non bloquant)
  try {
    // Vérifier la taille du fichier
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        // Rotation : renommer l'ancien fichier
        const backupFile = LOG_FILE.replace('.log', `.${Date.now()}.log`);
        fs.renameSync(LOG_FILE, backupFile);
        
        // Garder seulement les 3 derniers backups
        cleanOldLogs();
      }
    }

    fs.appendFileSync(LOG_FILE, logLine);
  } catch (e) {
    console.error('[logger] Erreur écriture log:', e);
  }
}

/**
 * Nettoyer les anciens logs (garder seulement les 3 plus récents)
 */
function cleanOldLogs() {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('sync.') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(DATA_DIR, f),
        time: fs.statSync(path.join(DATA_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    // Supprimer tout sauf les 3 plus récents
    files.slice(3).forEach(f => {
      try {
        fs.unlinkSync(f.path);
      } catch (e) {
        console.error('[logger] Erreur suppression ancien log:', e);
      }
    });
  } catch (e) {
    console.error('[logger] Erreur nettoyage logs:', e);
  }
}

/**
 * Récupérer les logs récents (pour l'UI)
 */
function getRecentLogs(limit = 100, filters = {}) {
  let logs = [...logsBuffer];

  // Filtrer par niveau
  if (filters.level) {
    logs = logs.filter(l => l.level === filters.level);
  }

  // Filtrer par catégorie
  if (filters.category) {
    logs = logs.filter(l => l.category === filters.category);
  }

  // Filtrer par date
  if (filters.since) {
    const sinceDate = new Date(filters.since);
    logs = logs.filter(l => new Date(l.timestamp) >= sinceDate);
  }

  // Limiter et retourner les plus récents
  return logs.slice(-limit).reverse();
}

/**
 * Export des logs vers un fichier texte
 */
function exportLogs() {
  try {
    const exportFile = path.join(DATA_DIR, `sync-export-${Date.now()}.log`);
    
    // Lire le fichier de log principal
    let content = '';
    if (fs.existsSync(LOG_FILE)) {
      content = fs.readFileSync(LOG_FILE, 'utf-8');
    }

    // Ajouter les logs en mémoire
    content += '\n\n=== LOGS EN MÉMOIRE ===\n\n';
    logsBuffer.forEach(l => {
      content += `[${l.timestamp}] [${l.level}] [${l.category}] ${l.message}${l.data ? ' ' + l.data : ''}\n`;
    });

    fs.writeFileSync(exportFile, content);
    return exportFile;
  } catch (e) {
    console.error('[logger] Erreur export logs:', e);
    return null;
  }
}

/**
 * Vider les logs
 */
function clearLogs() {
  try {
    logsBuffer = [];
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
    return true;
  } catch (e) {
    console.error('[logger] Erreur clear logs:', e);
    return false;
  }
}

/**
 * Génère un diagnostic complet du système
 */
function generateDiagnostic(db = null) {
  const diagnostic = {
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      dataDir: DATA_DIR,
    },
    environment: {
      deviceId: process.env.DEVICE_ID || 'unknown',
      apiUrl: process.env.VITE_API_URL || 'not set',
      tenantId: process.env.TENANT_ID || 'unknown',
    },
    logs: {
      total: logsBuffer.length,
      errors: logsBuffer.filter(l => l.level === 'ERROR').length,
      warnings: logsBuffer.filter(l => l.level === 'WARN').length,
      recentErrors: logsBuffer.filter(l => l.level === 'ERROR').slice(-10),
    },
    queue: {},
    database: {},
  };

  // Ajouter les stats de la queue si db fourni
  if (db) {
    try {
      const pendingOps = db.prepare('SELECT COUNT(*) as count FROM ops_queue WHERE ack = 0').get();
      const failedOps = db.prepare('SELECT COUNT(*) as count FROM ops_queue WHERE retry_count > 0').get();
      const recentOps = db.prepare('SELECT op_type, entity_type, created_at, last_error FROM ops_queue WHERE ack = 0 ORDER BY created_at DESC LIMIT 10').all();
      
      diagnostic.queue = {
        pending: pendingOps?.count || 0,
        failed: failedOps?.count || 0,
        recentOps: recentOps || [],
      };

      // Stats base de données
      const produits = db.prepare('SELECT COUNT(*) as count FROM produits').get();
      const ventes = db.prepare('SELECT COUNT(*) as count FROM ventes').get();
      const adherents = db.prepare('SELECT COUNT(*) as count FROM adherents').get();
      const stockMovements = db.prepare('SELECT COUNT(*) as count FROM stock_movements').get();
      
      diagnostic.database = {
        produits: produits?.count || 0,
        ventes: ventes?.count || 0,
        adherents: adherents?.count || 0,
        stockMovements: stockMovements?.count || 0,
      };

      // Taille de la base de données
      const dbPath = path.join(DATA_DIR, 'caisse.db');
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        diagnostic.database.sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      }
    } catch (e) {
      diagnostic.queue.error = e.message;
      diagnostic.database.error = e.message;
    }
  }

  return diagnostic;
}

/**
 * Exporte un diagnostic complet
 */
function exportDiagnostic(db = null) {
  try {
    const diagnostic = generateDiagnostic(db);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `diagnostic-${timestamp}.json`;
    const filepath = path.join(DATA_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(diagnostic, null, 2), 'utf-8');
    
    return { ok: true, filePath: filepath };
  } catch (e) {
    console.error('[logger] Erreur export diagnostic:', e);
    return { ok: false, error: e.message };
  }
}

// Helpers pour les différents niveaux
const logger = {
  info: (category, message, data) => log('INFO', category, message, data),
  warn: (category, message, data) => log('WARN', category, message, data),
  error: (category, message, data) => log('ERROR', category, message, data),
  debug: (category, message, data) => log('DEBUG', category, message, data),
  
  getRecentLogs,
  exportLogs,
  clearLogs,
  generateDiagnostic,
  exportDiagnostic,
};

module.exports = logger;
