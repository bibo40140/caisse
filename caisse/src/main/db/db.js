// src/main/db/db.js
const { getTenantDb } = require('./tenantDb');

const proxy = new Proxy({}, {
  get(_t, prop) {
    const db = getTenantDb();                 // choisit le fichier DB du tenant courant
    const v = db[prop];
    return typeof v === 'function' ? v.bind(db) : v;
  }
});

module.exports = proxy;
