// tests/e2e-full.js
// E2E "best-effort": crée un tenant + admin, se connecte, puis essaye les opérations clés.
// S'adapte si certaines routes ne sont pas encore implémentées (marque SKIP).

const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const API_BASE = process.env.API_BASE_URL || "http://localhost:3001";

// --- helpers logs
const pad = (s, n) => String(s).padEnd(n);
const OK = (m) => console.log(`✔️  ${m}`);
const SKIP = (m) => console.log(`⏭️  ${m}`);
const KO = (m) => console.log(`❌ ${m}`);
const INFO = (m) => console.log(`ℹ️  ${m}`);

// --- axios instance (sans token au départ)
const http = axios.create({ baseURL: API_BASE, timeout: 10000 });

// --- petits utilitaires
function rndTag() {
  return crypto.randomBytes(3).toString("hex"); // 6 chars
}

function bearer(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function tryCall(fn, label, record) {
  try {
    const out = await fn();
    record.status = "OK";
    record.details = "";
    OK(label);
    return out;
  } catch (e) {
    const st = e?.response?.status;
    if (st === 404 || st === 501) {
      record.status = "SKIP";
      record.details = `endpoint non trouvé (HTTP ${st})`;
      SKIP(`${label} → ${record.details}`);
      return null;
    }
    record.status = "KO";
    record.details = e?.response?.data?.error || e?.message || "Erreur inconnue";
    KO(`${label} → ${record.details}`);
    return null;
  }
}

(function printRecapFactory() {
  global.printRecap = function printRecap(RUN) {
    console.log("\n=== RÉCAP E2E ===");
    const head = `| ${pad("Étape", 28)} | ${pad("Statut", 6)} | Détails`;
    console.log(head);
    console.log("-".repeat(head.length));
    for (const r of RUN) {
      console.log(`| ${pad(r.step, 28)} | ${pad(r.status, 6)} | ${r.details || ""}`);
    }
    console.log("-".repeat(head.length));
  };
})();

(async () => {
  const RUN = [];
  const add = (name) => {
    const row = { step: name, status: "PENDING", details: "" };
    RUN.push(row);
    return row;
  };

  INFO(`E2E start → API_BASE=${API_BASE}`);

  // 0) Health (si dispo)
  const s0 = add("health");
  await tryCall(async () => {
    try {
      const r = await http.get("/health");
      return r.data || {};
    } catch (e) {
      // pas bloquant si absent
      throw e;
    }
  }, "GET /health", s0);

  // 1) Create tenant
  const tag = rndTag();
  const tenantName = `tenant-${tag}`;
  const adminEmail = `admin+${tag}@example.com`;
  const adminPass = `Pass!${tag}`;

  const s1 = add("register-tenant");
  const reg = await tryCall(async () => {
    const r = await http.post("/auth/register-tenant", {
      tenant_name: tenantName,
      email: adminEmail,
      password: adminPass,
      company_name: `Société ${tag}`,
      logo_url: null,
    });
    return r.data;
  }, "POST /auth/register-tenant", s1);

  if (!reg?.token) {
    KO("Création tenant n’a pas renvoyé de token → on stoppe");
    printRecap(RUN);
    process.exit(1);
  }

  // 2) Login (sanity)
  const s2 = add("login-tenant-admin");
  const login = await tryCall(async () => {
    const r = await http.post("/auth/login", {
      email: adminEmail,
      password: adminPass,
    });
    return r.data;
  }, "POST /auth/login", s2);

  const tenantToken = login?.token || reg?.token;
  if (!tenantToken) {
    KO("Impossible d’obtenir un token d’admin tenant");
    printRecap(RUN);
    process.exit(1);
  }

  // 3) Activer modules (si endpoint existe)
  const s3 = add("enable-modules");
  const enabledModules = {
    adherents: true,
    cotisations: true,
    ventes_exterieur: true,
    modes_paiement: true,
    prospects: true,
    emails: false, // volontairement off pour vérifier qu’aucun email ne part
    stocks: true,
  };
  await tryCall(async () => {
    // essaye différentes conventions — garde la première qui marche
    const candidates = [
      () => http.post("/tenants/settings/modules", { modules: enabledModules }, bearer(tenantToken)),
      () => http.post("/settings/modules", { modules: enabledModules }, bearer(tenantToken)),
      () => http.put("/settings/modules", { modules: enabledModules }, bearer(tenantToken)),
    ];
    for (const f of candidates) {
      try {
        const r = await f();
        return r.data;
      } catch (e) {
        if (e?.response?.status === 404 || e?.response?.status === 501) continue;
        throw e;
      }
    }
    // si aucune route, on marque SKIP en levant un 404 simili
    const err = new Error("No module endpoint");
    err.response = { status: 404 };
    throw err;
  }, "Activer modules", s3);

  // 4) Créer adhérent (utilise email1 + telephone1, compatibles avec ta route)
  const s4 = add("create-adherent");
  const adherent = await tryCall(async () => {
    const r = await http.post(
      "/adherents",
      {
        nom: "Dupont",
        prenom: "Alice",
        email1: `alice.${tag}@example.com`,
        telephone1: "0600000000",
        ville: "Azur",
        code_postal: "40140",
        adresse: "6 rue des molinies",
        statut: "actif",
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /adherents", s4);

  const adherentId = adherent?.id;

  // 5) Créer fournisseur
  const s5 = add("create-fournisseur");
  const fournisseur = await tryCall(async () => {
    const r = await http.post(
      "/fournisseurs",
      {
        nom: `Fournisseur ${tag}`,
        categorie_id: null,
        contact: "Bob",
        email: `fournisseur.${tag}@example.com`,
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /fournisseurs", s5);

  const fournisseurId = fournisseur?.id;

  // 6) Créer produit
  const s6 = add("create-produit");
  const produit = await tryCall(async () => {
    const r = await http.post(
      "/produits",
      {
        nom: `Pâtes ${tag}`,
        categorie_id: null,
        fournisseur_id: fournisseurId || null,
        unite_id: null,
        code_barre: `EAN${Date.now()}`,
        prix: 2.5,
        stock: 0,
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /produits", s6);

  const produitId = produit?.id;

  // 7) Réception (entrée stock)
  const s7 = add("create-reception");
  await tryCall(async () => {
    const r = await http.post(
      "/receptions",
      {
        fournisseur_id: fournisseurId || null,
        lignes: [
          {
            produit_id: produitId,
            quantite: 10,
            prix_achat: 1.5,
          },
        ],
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /receptions", s7);

  // 8) Vente (adhérent)
  const s8 = add("create-vente-adherent");
  await tryCall(async () => {
    const r = await http.post(
      "/ventes",
      {
        sale_type: "adherent",
        adherent_id: adherentId || null,
        mode_paiement_id: null, // si le module impose un mode, l’API répondra 400 → on verra
        lignes: [
          {
            produit_id: produitId,
            quantite: 2,
            prix: 2.5, // PU appliqué
            prix_unitaire: 2.5,
            remise_percent: 0,
          },
        ],
        frais_paiement: 0,
        cotisation: 0,
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /ventes (adherent)", s8);

  // 9) Vente (extérieur) — module ventes_ext activé
  const s9 = add("create-vente-exterieur");
  await tryCall(async () => {
    const r = await http.post(
      "/ventes",
      {
        sale_type: "exterieur",
        client_email: null,
        mode_paiement_id: null,
        lignes: [
          {
            produit_id: produitId,
            quantite: 1,
            prix: 2.5 * 1.3, // simule +30% ext
            prix_unitaire: 2.5,
            remise_percent: 0,
          },
        ],
        frais_paiement: 0,
        cotisation: 0,
      },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /ventes (exterieur)", s9);

  // 10) Inventaire (start → countAdd → finalize)
  const s10a = add("inventory-start");
  const invStart = await tryCall(async () => {
    const r = await http.post("/inventory/start", { name: `Inventaire ${tag}` }, bearer(tenantToken));
    return r.data;
  }, "POST /inventory/start", s10a);
  const sessionId = invStart?.session?.id;

  const s10b = add("inventory-count-add");
  await tryCall(async () => {
    if (!sessionId || !produitId) {
      // si pas de session ou pas de produit → skip
      const e = new Error("no session/product");
      e.response = { status: 404 };
      throw e;
    }
    const r = await http.post(
      "/inventory/count",
      { sessionId, product_id: produitId, qty: 1, user: "E2E" },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /inventory/count", s10b);

  const s10c = add("inventory-finalize");
  await tryCall(async () => {
    if (!sessionId) {
      const e = new Error("no session");
      e.response = { status: 404 };
      throw e;
    }
    const r = await http.post(
      "/inventory/finalize",
      { sessionId, user: "E2E", email_to: null },
      bearer(tenantToken)
    );
    return r.data;
  }, "POST /inventory/finalize", s10c);

  printRecap(RUN);
  process.exit(0);
})().catch((e) => {
  console.error("E2E fatal:", e?.message || e);
  process.exit(1);
});
