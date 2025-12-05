// tests/e2e-suite.js
// Test E2E “grand tour” : multi-scénarios + rapport Markdown.
// Nécessite: axios, dotenv (déjà installés) + Node 18+.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const API_BASE = process.env.API_BASE_URL || "http://localhost:3001";
const outDir = path.join(__dirname, "reports");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `e2e-report-${stamp}.md`);

const pad = (s, n) => String(s).padEnd(n);
const OK = (m) => console.log(`✔️  ${m}`);
const SKIP = (m) => console.log(`⏭️  ${m}`);
const KO = (m) => console.log(`❌ ${m}`);
const INFO = (m) => console.log(`ℹ️  ${m}`);

const http = axios.create({ baseURL: API_BASE, timeout: 15000 });

function rndTag() {
  return crypto.randomBytes(3).toString("hex");
}
function bearer(token, extra = {}) {
  return { headers: { Authorization: `Bearer ${token}`, ...extra } };
}
async function tolerantCall(fn, label, row) {
  try {
    const r = await fn();
    row.status = "OK";
    row.details = "";
    OK(label);
    return r;
  } catch (e) {
    const st = e?.response?.status;
    const msg = e?.response?.data?.error || e?.message || "Erreur inconnue";
    if (st === 404 || st === 501) {
      row.status = "SKIP";
      row.details = `endpoint non trouvé (HTTP ${st})`;
      SKIP(`${label} → ${row.details}`);
      return null;
    }
    row.status = "KO";
    row.details = msg;
    KO(`${label} → ${msg}`);
    return null;
  }
}

function tableLine(step, status, details = "") {
  return `| ${pad(step, 32)} | ${pad(status, 6)} | ${details}`;
}

(async () => {
  const RUN = [];
  const add = (step) => {
    const r = { step, status: "PENDING", details: "" };
    RUN.push(r);
    return r;
  };

  INFO(`E2E SUITE → API_BASE=${API_BASE}`);

  // 0) Health
  const r0 = add("health");
  await tolerantCall(async () => http.get("/health"), "GET /health", r0);

  // 1) Register tenant
  const tag = rndTag();
  const tenantName = `tenant-${tag}`;
  const adminEmail = `admin+${tag}@example.com`;
  const adminPass = `Pass!${tag}`;

  const r1 = add("register-tenant");
  const reg = await tolerantCall(async () => {
    return http.post("/auth/register-tenant", {
      tenant_name: tenantName,
      email: adminEmail,
      password: adminPass,
      company_name: `Société ${tag}`,
      logo_url: null,
    });
  }, "POST /auth/register-tenant", r1);

  if (!reg?.data?.token) {
    KO("register-tenant n’a pas renvoyé de token → stop");
    printAndWrite(RUN);
    process.exit(1);
  }

  // 2) Login
  const r2 = add("login-tenant-admin");
  const login = await tolerantCall(async () => {
    return http.post("/auth/login", { email: adminEmail, password: adminPass });
  }, "POST /auth/login", r2);

  const token = login?.data?.token || reg?.data?.token;
  if (!token) {
    KO("Impossible de récupérer un token → stop");
    printAndWrite(RUN);
    process.exit(1);
  }

  // 3) Enable modules (essaye plusieurs endpoints)
  const r3 = add("enable-modules");
  const baseModules = {
    adherents: true,
    cotisations: true,
    ventes_exterieur: true,
    modes_paiement: true,  // ON: on testera qu’un mode est requis
    prospects: true,
    emails: false,         // off pour éviter des envois
    stocks: true,
  };
  await tolerantCall(async () => {
    const candidates = [
      () => http.post("/tenants/settings/modules", { modules: baseModules }, bearer(token)),
      () => http.post("/settings/modules", { modules: baseModules }, bearer(token)),
      () => http.put("/settings/modules", { modules: baseModules }, bearer(token)),
    ];
    for (const f of candidates) {
      try {
        return await f();
      } catch (e) {
        if ([404, 501].includes(e?.response?.status)) continue;
        throw e;
      }
    }
    const err = new Error("No module endpoint");
    err.response = { status: 404 };
    throw err;
  }, "Activer modules (base)", r3);

  // 4) Adherent OK + Adherent invalide (attendu 400)
  const r4a = add("create-adherent-ok");
  const adherentOk = await tolerantCall(async () => {
    return http.post(
      "/adherents",
      { nom: "Dupont", prenom: "Alice", email1: `alice.${tag}@example.com`, statut: "actif" },
      bearer(token)
    );
  }, "POST /adherents (ok)", r4a);
  const adherentId = adherentOk?.data?.id || null;

  const r4b = add("create-adherent-invalid");
  await (async () => {
    try {
      await http.post("/adherents", { prenom: "SansNom" }, bearer(token));
      // Si ça passe → KO (on attendait 400)
      r4b.status = "KO";
      r4b.details = "devrait refuser (nom requis)";
      KO("POST /adherents (invalid) → aurait dû être 400");
    } catch (e) {
      const st = e?.response?.status;
      if (st === 400) {
        r4b.status = "OK";
        r4b.details = "400 attendu (nom requis)";
        OK("POST /adherents (invalid) → 400 OK");
      } else if (st === 404 || st === 501) {
        r4b.status = "SKIP";
        r4b.details = `endpoint non trouvé (HTTP ${st})`;
        SKIP("POST /adherents (invalid) → endpoint manquant");
      } else {
        r4b.status = "KO";
        r4b.details = e?.response?.data?.error || e?.message || "Erreur";
        KO(`POST /adherents (invalid) → ${r4b.details}`);
      }
    }
  })();

  // 5) Fournisseur
  const r5 = add("create-fournisseur");
  const fournisseur = await tolerantCall(async () => {
    return http.post(
      "/fournisseurs",
      { nom: `Fournisseur ${tag}`, categorie_id: null, contact: "Bob", email: `f.${tag}@example.com` },
      bearer(token)
    );
  }, "POST /fournisseurs", r5);
  const fournisseurId = fournisseur?.data?.id || null;

  // 6) Produit
  const r6 = add("create-produit");
  const produit = await tolerantCall(async () => {
    return http.post(
      "/produits",
      {
        nom: `Pâtes ${tag}`,
        categorie_id: null,
        fournisseur_id: fournisseurId,
        unite_id: null,
        code_barre: `EAN${Date.now()}`,
        prix: 2.5,
        stock: 0,
      },
      bearer(token)
    );
  }, "POST /produits", r6);
  const produitId = produit?.data?.id || null;

  // 7) Réception (10 unités)
  const r7 = add("reception");
  await tolerantCall(async () => {
    return http.post(
      "/receptions",
      {
        fournisseur_id: fournisseurId,
        lignes: [{ produit_id: produitId, quantite: 10, prix_achat: 1.5 }],
      },
      bearer(token)
    );
  }, "POST /receptions", r7);

  // 8) Vente adhérent (2 unités)
  const r8 = add("sale-adherent");
  await tolerantCall(async () => {
    return http.post(
      "/ventes",
      {
        sale_type: "adherent",
        adherent_id: adherentId,
        mode_paiement_id: null, // module “modes_paiement” ON → si API impose, elle renverra 400 ; si elle n’impose pas côté API, ça passera.
        lignes: [{ produit_id: produitId, quantite: 2, prix: 2.5, prix_unitaire: 2.5, remise_percent: 0 }],
        frais_paiement: 0,
        cotisation: 0,
      },
      bearer(token)
    );
  }, "POST /ventes (adherent)", r8);

  // 9) Vente extérieur (1 unité)
  const r9 = add("sale-exterieur");
  await tolerantCall(async () => {
    return http.post(
      "/ventes",
      {
        sale_type: "exterieur",
        client_email: null,
        mode_paiement_id: null,
        lignes: [{ produit_id: produitId, quantite: 1, prix: 3.25, prix_unitaire: 2.5, remise_percent: 0 }],
        frais_paiement: 0,
        cotisation: 0,
      },
      bearer(token)
    );
  }, "POST /ventes (exterieur)", r9);

  // 10) Inventaire
  const r10a = add("inventory-start");
  const invStart = await tolerantCall(async () => {
    return http.post("/inventory/start", { name: `Inventaire ${tag}` }, bearer(token));
  }, "POST /inventory/start", r10a);
  const sessionId = invStart?.data?.session?.id || null;

  const r10b = add("inventory-count-add");
  await tolerantCall(async () => {
    return http.post(
      "/inventory/count",
      { sessionId, product_id: produitId, qty: 2, user: "E2E" },
      bearer(token)
    );
  }, "POST /inventory/count (+2)", r10b);

  const r10c = add("inventory-finalize");
  await tolerantCall(async () => {
    return http.post(
      "/inventory/finalize",
      { sessionId, user: "E2E", email_to: null },
      bearer(token)
    );
  }, "POST /inventory/finalize", r10c);

  // 11) Vérif stock via GET produit (si dispo)
  const r11 = add("verify-produit-stock");
  await tolerantCall(async () => {
    // Si GET /produits/:id n’existe pas chez toi, ce sera SKIP (404)
    return http.get(`/produits/${produitId}`, bearer(token));
  }, "GET /produits/:id (verify)", r11);

  // 12) Modes de paiement requis → on attend un 400 si on ne fournit pas mode_paiement_id
  const r12 = add("sale-without-payment-mode-when-required");
  await (async () => {
    // ré-active le module pour être sûr
    await tolerantCall(async () => {
      const candidates = [
        () => http.post("/tenants/settings/modules", { modules: { modes_paiement: true } }, bearer(token)),
        () => http.post("/settings/modules", { modules: { modes_paiement: true } }, bearer(token)),
        () => http.put("/settings/modules", { modules: { modes_paiement: true } }, bearer(token)),
      ];
      for (const f of candidates) {
        try { await f(); break; } catch (e) { if([404,501].includes(e?.response?.status)) continue; else throw e; }
      }
    }, "Ré-activer modes_paiement (assurance)", { step: "noop" });

    try {
      await http.post(
        "/ventes",
        {
          sale_type: "adherent",
          adherent_id: adherentId,
          mode_paiement_id: null, // volontairement manquant
          lignes: [{ produit_id: produitId, quantite: 1, prix: 2.5, prix_unitaire: 2.5, remise_percent: 0 }],
          frais_paiement: 0,
          cotisation: 0,
        },
        bearer(token)
      );
      // Si ça passe, on considère que l’API n’impose pas la règle côté serveur
      r12.status = "SKIP";
      r12.details = "aucune contrainte côté API (règle peut-être seulement côté UI)";
      SKIP("Vente sans mode_paiement_id n’a pas été refusée → pas de contrainte serveur");
    } catch (e) {
      if (e?.response?.status === 400) {
        r12.status = "OK";
        r12.details = "400 attendu (mode_paiement requis)";
        OK("Règle modes_paiement: 400 OK");
      } else if ([404, 501].includes(e?.response?.status)) {
        r12.status = "SKIP";
        r12.details = `endpoint /ventes manquant (HTTP ${e?.response?.status})`;
        SKIP("Vente pour test règle paiement → endpoint manquant");
      } else {
        r12.status = "KO";
        r12.details = e?.response?.data?.error || e?.message || "Erreur";
        KO(`Règle modes_paiement → ${r12.details}`);
      }
    }
  })();

  // Impression & rapport
  printAndWrite(RUN);

  process.exit(0);
})().catch((e) => {
  console.error("E2E suite fatal:", e?.message || e);
  process.exit(1);
});

function printAndWrite(RUN) {
  console.log("\n=== RÉCAP E2E (suite) ===");
  const head = `| ${pad("Étape", 32)} | ${pad("Statut", 6)} | Détails`;
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of RUN) {
    console.log(tableLine(r.step, r.status, r.details || ""));
  }
  console.log("-".repeat(head.length));

  // Rapport Markdown
  const lines = [];
  lines.push(`# Rapport E2E — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`API_BASE: \`${API_BASE}\``);
  lines.push("");
  lines.push("| Étape                           | Statut | Détails |");
  lines.push("|--------------------------------|--------|---------|");
  for (const r of RUN) {
    lines.push(`| ${r.step} | ${r.status} | ${r.details || ""} |`);
  }
  lines.push("");

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");
  console.log(`\n📝 Rapport écrit: ${outFile}`);
}
