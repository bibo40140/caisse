// scripts/smoke.js
// Run: node scripts/smoke.js --api http://localhost:3001 [--sqlite "C:/path/coopaz.db"]
// Node 18+ recommandé (fetch natif). Pour Node<18: npm i node-fetch && décommente la ligne indiquée.

import fs from 'fs';
import path from 'path';
import process from 'process';

// // Node < 18 ? décommente la ligne suivante :
// // import fetch from 'node-fetch';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--api') out.api = args[++i];
    else if (a === '--sqlite') out.sqlite = args[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function logStep(title) {
  console.log('\n═══ ' + title + ' ═══');
}

async function getJSON(url, init) {
  const res = await fetch(url, init);
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${txt}`);
  }
  try { return JSON.parse(txt); } catch { return txt; }
}

function rndId() {
  // pseudo uuid compact pour marquer l'op batch
  return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function main() {
  const { api, sqlite, help } = parseArgs();
  if (help || !api) {
    console.log('Usage: node scripts/smoke.js --api http://localhost:3001 [--sqlite /path/to/coopaz.db]');
    process.exit(0);
  }
  console.log('API_BASE =', api);
  if (sqlite) console.log('SQLITE   =', sqlite);

  // 1) Health
  logStep('HEALTH');
  const health = await getJSON(`${api}/health`);
  console.log('GET /health ->', health);
  const healthDb = await getJSON(`${api}/health/db`);
  console.log('GET /health/db ->', healthDb);

  // 2) Pull refs
  logStep('PULL REFS');
  const pull1 = await getJSON(`${api}/sync/pull_refs`);
  if (!pull1?.ok) throw new Error('pull_refs not ok');
  const produits = pull1?.data?.produits || [];
  if (!Array.isArray(produits) || produits.length === 0) {
    throw new Error('Aucun produit renvoyé par /sync/pull_refs (il en faut au moins 1)');
  }
  const p = produits.find(x => Number.isFinite(Number(x.id))) || produits[0];
  const pid = Number(p.id);
  const stock0 = Number(p.stock || 0);
  console.log(`Produit test: id=${pid}, nom="${p.nom}", stockInitial=${stock0}`);

  // 3) Push ops — on utilise un deviceId bidon, c’est sans importance côté serveur
  logStep('PUSH OPS (reception + stock.set + inventory.adjust)');
  const batchId = rndId();

  // On simule :
  // - reception.line_added: +2
  // - stock.set: stock = (stock courant + 3)
  // - inventory.adjust: -3 (revient au final à +2 par rapport à stock0)
  const opsPayload = {
    deviceId: 'smoke-test-device',
    ops: [
      {
        id: rndId(),
        op_type: 'reception.line_added',
        entity_type: 'reception',
        entity_id: '', // laissé vide → le serveur créer/associe l’entête si besoin
        payload_json: JSON.stringify({
          produitId: pid,
          quantite: 2,
          prixUnitaire: null,
          receptionId: null,
          fournisseurId: null,
          reference: `SMOKE-${batchId}`
        })
      },
      {
        id: rndId(),
        op_type: 'stock.set',
        entity_type: 'produit',
        entity_id: String(pid),
        payload_json: JSON.stringify({
          productId: pid,
          newStock: stock0 + 3
        })
      },
      {
        id: rndId(),
        op_type: 'inventory.adjust',
        entity_type: 'produit',
        entity_id: String(pid),
        payload_json: JSON.stringify({
          produitId: pid,
          delta: -3
        })
      }
    ]
  };

  const pushRes = await getJSON(`${api}/sync/push_ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opsPayload)
  });
  console.log('POST /sync/push_ops ->', pushRes);

  // 4) Pull refs à nouveau et vérifier le stock
  logStep('PULL REFS (post-push)');
  const pull2 = await getJSON(`${api}/sync/pull_refs`);
  const produits2 = pull2?.data?.produits || [];
  const p2 = produits2.find(x => Number(x.id) === pid);
  if (!p2) throw new Error('Produit test non retrouvé après push');
  const stock1 = Number(p2.stock || 0);
  const expected = stock0  // +2 (reception), +3 (set), -3 (adjust) => +2
  console.log(`Stock attendu = ${expected} | Stock serveur = ${stock1}`);
  if (stock1 !== expected) {
    throw new Error(`Mismatch stock: attendu ${expected}, lu ${stock1}`);
  }
  console.log('✔ Stock serveur OK');

  // 5) (Optionnel) Vérification SQLite local
  if (sqlite) {
    logStep('CHECK SQLITE (optionnel)');
    let betterSqlite3;
    try {
      betterSqlite3 = (await import('better-sqlite3')).default;
    } catch {
      console.warn('better-sqlite3 non installé. Fais: npm i better-sqlite3 (ou omets --sqlite).');
      return;
    }
    if (!fs.existsSync(sqlite)) {
      console.warn('Fichier SQLite introuvable:', sqlite);
    } else {
      const db = new betterSqlite3(sqlite);
      const hasTable = (name) => {
        const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
        return !!r;
      };
      const tables = ['ops_queue','stock_movements','ventes','lignes_vente','receptions','lignes_reception','produits'];
      for (const t of tables) {
        console.log(`- table ${t}:`, hasTable(t) ? 'OK' : 'ABSENTE');
      }
      const pending = db.prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`).get()?.n || 0;
      console.log('ops_queue en attente =', pending);
      db.close();
    }
  }

  console.log('\n✅ SMOKE TEST TERMINÉ SANS ERREUR');
}

main().catch((e) => {
  console.error('\n❌ SMOKE TEST ÉCHEC:', e?.message || e);
  process.exit(1);
});
