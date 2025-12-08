// push_ops_test.js
// Usage (PowerShell):
// $env:CAISSE_API_URL='http://localhost:3001'; $env:API_AUTH_TOKEN='Bearer ...'; node push_ops_test.js

const fetch = require('node-fetch');
const { randomUUID } = require('crypto');

if (!process.env.API_BASE_URL) {
  console.warn('[INFO] La variable API_BASE_URL n\'est pas définie. Utilisation de http://localhost:3001 par défaut.');
}
const API = process.env.API_BASE_URL || 'http://localhost:3001';
const TOKEN = process.env.API_AUTH_TOKEN || process.env.API_TOKEN || null;
const TENANT = process.env.TENANT_ID || null;

if (!TOKEN) {
  console.error('API_AUTH_TOKEN env var (Bearer token) is required for this test.');
  process.exit(1);
}

(async () => {
  try {
    const deviceId = process.env.DEVICE_ID || 'test-device-1';

    // Create a local session id to simulate local client id
    const localSessionId = Math.floor(Math.random() * 1000000);

    const ops = [
      {
        id: randomUUID(),
        op_type: 'inventory.session_start',
        entity_type: 'inventory_session',
        entity_id: String(localSessionId),
        payload_json: JSON.stringify({ local_session_id: localSessionId, name: 'Test Inventaire', user: 'tester' })
      },
      {
        id: randomUUID(),
        op_type: 'inventory.count_add',
        entity_type: 'inventory',
        entity_id: String(localSessionId),
        payload_json: JSON.stringify({ session_id: localSessionId, local_produit_id: 1, qty: 2, device_id: deviceId, user: 'tester' })
      },
      {
        id: randomUUID(),
        op_type: 'inventory.finalize',
        entity_type: 'inventory_session',
        entity_id: String(localSessionId),
        payload_json: JSON.stringify({ session_id: localSessionId, user: 'tester' })
      }
    ];

    const res = await fetch(`${API}/sync/push_ops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': TOKEN,
        ...(TENANT ? { 'x-tenant-id': TENANT } : {})
      },
      body: JSON.stringify({ deviceId, ops })
    });

    const txt = await res.text();
    console.log('HTTP', res.status);
    try { console.log(JSON.parse(txt)); } catch { console.log(txt); }
  } catch (e) {
    console.error(e);
  }
})();
