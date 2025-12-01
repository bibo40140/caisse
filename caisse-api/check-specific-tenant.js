/**
 * Vérifie le logo pour un tenant spécifique
 */

import 'dotenv/config';
import { pool } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANT_ID = 'a9e2067c-fd69-4715-bf02-9c6261aa646f';

async function main() {
  try {
    // Récupérer les paramètres
    const settingsRes = await pool.query(
      `SELECT logo_url, company_name FROM tenant_settings WHERE tenant_id = $1`,
      [TENANT_ID]
    );
    
    if (settingsRes.rowCount === 0) {
      console.log('❌ Aucun tenant_settings pour ce tenant');
      process.exit(1);
    }
    
    const settings = settingsRes.rows[0];
    const logoUrl = settings.logo_url || null;
    const companyName = settings.company_name || null;
    
    console.log('✅ Tenant:', TENANT_ID);
    console.log('📋 Configuration:');
    console.log('  company_name:', companyName);
    console.log('  logo_url:', logoUrl);
    console.log('');
    
    if (logoUrl) {
      const rel = String(logoUrl).replace(/^[\\\/]+/, '');
      const resolvedPath = path.join(__dirname, rel);
      
      console.log('📁 Fichier:');
      console.log('  Chemin résolu:', resolvedPath);
      
      try {
        const stat = fs.statSync(resolvedPath);
        console.log('  ✅ Fichier existe!');
        console.log('  Taille:', Math.round(stat.size / 1024), 'KB');
      } catch (e) {
        console.log('  ❌ Fichier introuvable:', e.message);
      }
    }
    
  } catch (e) {
    console.error('❌ Erreur:', e);
  } finally {
    await pool.end();
  }
}

main();
