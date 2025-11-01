// tests/e2e-smoke.js
// Smoke test minimal: vérifie qu'on peut joindre l'API et que /auth/login répond.

const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const API_BASE = process.env.API_BASE || "http://localhost:3001";

const ok = (msg) => console.log(`[OK] ${msg}`);
const info = (msg) => console.log(`[i] ${msg}`);
const warn = (msg) => console.warn(`[warn] ${msg}`);
const err = (msg) => console.error(`[ERROR] ${msg}`);

(async () => {
  info(`Smoke test démarré. API_BASE=${API_BASE}`);

  try {
    // 1) /health (si dispo)
    try {
      const r = await axios.get(`${API_BASE}/health`);
      ok(`/health status=${r.status}`);
    } catch (e) {
      const r = e.response;
      if (r && r.status) {
        info(`/health répondu status=${r.status} (ok, route peut ne pas exister)`);
      } else {
        warn(`/health non disponible (non bloquant)`);
      }
    }

    // 2) /auth/login avec faux identifiants : on s’attend à 401 → prouve que l’API répond
    try {
      await axios.post(`${API_BASE}/auth/login`, {
        email: "nobody@example.com",
        password: "wrong-password",
      });
      warn(`/auth/login a accepté de faux identifiants (surprenant, mais API joignable)`);
    } catch (e) {
      const r = e.response;
      if (r && r.status === 401) {
        ok(`/auth/login retourne 401 avec faux identifiants (normal, API OK)`);
      } else if (r && r.status) {
        info(`/auth/login status=${r.status} (API joignable)`);
      } else {
        throw new Error("Impossible de contacter /auth/login");
      }
    }

    ok("Smoke test terminé ✅");
    process.exit(0);
  } catch (e) {
    err(`E2E ABORT: ${e.message || e}`);
    process.exit(1);
  }
})();
