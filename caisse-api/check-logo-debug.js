/**
 * check-logo-debug.js
 * Vérifie la configuration du logo pour le premier tenant
 */

import 'dotenv/config';
import { pool } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    // Récupérer le premier tenant
    const tenantRes = await pool.query(`SELECT id, name FROM tenants ORDER BY created_at LIMIT 1`);
    if (tenantRes.rowCount === 0) {
      console.error('❌ Aucun tenant trouvé');
      process.exit(1);
    }
    
    const tenant = tenantRes.rows[0];
    console.log('✅ Tenant:', tenant.name, `(${tenant.id})`);
    console.log('');

    // Récupérer les paramètres
    const settingsRes = await pool.query(
      `SELECT logo_url, company_name FROM tenant_settings WHERE tenant_id = $1`,
      [tenant.id]
    );
    
    const settings = settingsRes.rows[0] || {};
    const logoUrl = settings.logo_url || null;
    const companyName = settings.company_name || null;
    
    console.log('📋 Configuration:');
    console.log('  company_name:', companyName || '(non défini)');
    console.log('  logo_url:', logoUrl || '(non défini)');
    console.log('');
    
    if (!logoUrl) {
      console.log('⚠️  Aucun logo_url configuré dans tenant_settings');
      console.log('   → Upload un logo via Paramètres > Logo & Nom');
      process.exit(0);
    }
    
    // Vérifier si le fichier existe
    if (String(logoUrl).startsWith('http')) {
      console.log('🌐 Logo est une URL externe:', logoUrl);
      console.log('   → Les clients email doivent pouvoir accéder à cette URL');
    } else {
      const rel = String(logoUrl).replace(/^[\\\/]+/, '');
      const resolvedPath = path.join(__dirname, rel);
      
      console.log('📁 Logo est un fichier local:');
      console.log('  Chemin relatif:', logoUrl);
      console.log('  Chemin résolu:', resolvedPath);
      console.log('');
      
      try {
        const stat = fs.statSync(resolvedPath);
        if (stat.isFile()) {
          console.log('✅ Fichier trouvé!');
          console.log('  Taille:', Math.round(stat.size / 1024), 'KB');
          console.log('  Extension:', path.extname(resolvedPath));
          console.log('');
          console.log('✨ Le logo sera intégré en pièce jointe inline (CID) dans les emails');
        } else {
          console.log('❌ Le chemin existe mais n\'est pas un fichier');
        }
      } catch (e) {
        console.log('❌ Fichier introuvable!');
        console.log('  Erreur:', e.message);
        console.log('');
        console.log('💡 Solutions:');
        console.log('  1. Vérifie que le logo a bien été uploadé via l\'interface');
        console.log('  2. Vérifie que le dossier public/logos/ existe');
        console.log('  3. Regarde dans', path.join(__dirname, 'public', 'logos'));
      }
    }
    
  } catch (e) {
    console.error('❌ Erreur:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
