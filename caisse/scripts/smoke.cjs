// scripts/smoke.cjs
const fs = require('fs');
const process = require('process');
// Pour Node < 18 : const fetch = require('node-fetch');

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

function logStep(title) { console.log('\n═══ ' + title + ' ═══'); }

async function getJSON(url, init) {
  const res = await fetch(url, init);
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${txt}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

function rndId() { return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

(async () => {
  const { api, sqlite, help } = parseArgs();
  if (help || !api) {
    console.log('Usage: node scripts/smoke.cjs --api http://localhost:3001 [--sqlite PATH]');
    process.exit(0);
  }
  console.log('API_BASE =', api);

  logStep('HEALTH');
  console.log('GET /health ->', await getJSON(`${api}/health`));
  console.log('GET /health/db ->', await getJSON(`${api}/health/db`));

  logStep('PULL REFS');
  const pull1 = await getJSON(`${api}/sync/pull_refs`);
  const produits = pull1?.data?.produits || [];
  if (!produits.length) throw new Error('Aucun produit');
  const p = produits[0];
  const pid = Number(p.id);
  const stock0 = Number(p.stock || 0);
  console.log(`Produit test: id=${pid}, nom="${p.nom}", stockInitial=${stock0}`);

  logStep('PUSH OPS (reception + stock.set + inventory.adjust)');
  const batchId = rndId();
  const opsPayload = {
    deviceId: 'smoke-test-device',
    ops: [
      { id: rndId(), op_type: 'reception.line_added', entity_type: 'reception', entity_id: '',
        payload_json: JSON.stringify({ produitId: pid, quantite: 2, prixUnitaire: null, receptionId: null, fournisseurId: null, reference: `SMOKE-${batchId}` }) },
      { id: rndId(), op_type: 'stock.set', entity_type: 'produit', entity_id: String(pid),
        payload_json: JSON.stringify({ productId: pid, newStock: stock0 + 3 }) },
      { id: rndId(), op_type: 'inventory.adjust', entity_type: 'produit', entity_id: String(pid),
        payload_json: JSON.stringify({ produitId: pid, delta: -3 }) },
    ]
  };
  console.log('POST /sync/push_ops ->', await getJSON(`${api}/sync/push_ops`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opsPayload)
  }));

  logStep('PULL REFS (post-push)');
  const pull2 = await getJSON(`${api}/sync/pull_refs`);
  const p2 = (pull2?.data?.produits || []).find(x => Number(x.id) === pid);
  if (!p2) throw new Error('Produit non retrouvé');
  const stock1 = Number(p2.stock || 0);
  const expected = stock0; // ✅
  console.log(`Stock attendu = ${expected} | Stock serveur = ${stock1}`);
  if (stock1 !== expected) throw new Error(`Mismatch stock: attendu ${expected}, lu ${stock1}`);

  console.log('\n✅ SMOKE TEST TERMINÉ SANS ERREUR');
})().catch((e) => {
  console.error('\n❌ SMOKE TEST ÉCHEC:', e?.message || e);
  process.exit(1);
});
