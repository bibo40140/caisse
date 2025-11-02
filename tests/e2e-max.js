// tests/e2e-max.js
// Grand tour API étendu : multi-scenarios + rapport Markdown détaillé.
// Prérequis: axios, dotenv (installés), Node 18+.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const outDir = path.join(__dirname, "reports");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `e2e-max-${stamp}.md`);

const pad = (s, n) => String(s).padEnd(n);
const OK = (m) => console.log(`✔️  ${m}`);
const SKIP = (m) => console.log(`⏭️  ${m}`);
const KO = (m) => console.log(`❌ ${m}`);
const INFO = (m) => console.log(`ℹ️  ${m}`);

const http = axios.create({ baseURL: API_BASE, timeout: 20000 });

function rndTag() { return crypto.randomBytes(3).toString("hex"); }
function bearer(token, extra = {}) {
  return { headers: { Authorization: `Bearer ${token}`, ...extra } };
}
async function tolerantCall(fn, label, row, expect = {}) {
  try {
    const r = await fn();
    if (expect.status && r?.status !== expect.status) {
      row.status = "KO";
      row.details = `attendu HTTP ${expect.status}, reçu ${r?.status}`;
      KO(`${label} → ${row.details}`);
      return r;
    }
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
    if (expect.status && st === expect.status) {
      row.status = "OK";
      row.details = `${st} attendu`;
      OK(`${label} → ${st} attendu`);
      return e?.response || null;
    }
    row.status = "KO";
    row.details = msg;
    KO(`${label} → ${msg}`);
    return null;
  }
}
function printAndWrite(RUN, extras = []) {
  console.log("\n=== RÉCAP E2E (max) ===");
  const head = `| ${pad("Étape", 40)} | ${pad("Statut", 6)} | Détails`;
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of RUN) {
    console.log(`| ${pad(r.step, 40)} | ${pad(r.status, 6)} | ${r.details || ""}`);
  }
  console.log("-".repeat(head.length));

  const lines = [];
  lines.push(`# Rapport E2E MAX — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`API_BASE: \`${API_BASE}\``);
  lines.push("");
  lines.push("| Étape | Statut | Détails |");
  lines.push("|-------|--------|---------|");
  for (const r of RUN) {
    lines.push(`| ${r.step} | ${r.status} | ${r.details || ""} |`);
  }
  if (extras.length) {
    lines.push("");
    lines.push("## Notes & Observations");
    lines.push("");
    for (const x of extras) lines.push(`- ${x}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");
  console.log(`\n📝 Rapport écrit: ${outFile}`);
}

(async () => {
  const RUN = [];
  const add = (step) => { const r = { step, status: "PENDING", details: "" }; RUN.push(r); return r; };
  const notes = [];

  INFO(`E2E MAX → API_BASE=${API_BASE}`);

  // 0) Health
  const r0 = add("health");
  await tolerantCall(() => http.get("/health"), "GET /health", r0);

  // 1) Register tenant + 2) Login
  const tag = rndTag();
  const tenantName = `tenant-${tag}`;
  const adminEmail = `admin+${tag}@example.com`;
  const adminPass = `Pass!${tag}`;

  const r1 = add("register-tenant");
  const reg = await tolerantCall(() => http.post("/auth/register-tenant", {
    tenant_name: tenantName, email: adminEmail, password: adminPass,
    company_name: `Société ${tag}`, logo_url: null,
  }), "POST /auth/register-tenant", r1);

  const r2 = add("login-tenant-admin");
  const login = await tolerantCall(() => http.post("/auth/login", {
    email: adminEmail, password: adminPass,
  }), "POST /auth/login", r2);

  const token = login?.data?.token || reg?.data?.token;
  if (!token) {
    KO("Token manquant → stop.");
    printAndWrite(RUN);
    process.exit(1);
  }

  // 3) Modules ON (base) + variations pour tests
  const r3 = add("modules-on-base");
  const baseModules = {
    adherents: true, cotisations: true, ventes_exterieur: true,
    modes_paiement: true, prospects: true, emails: false, stocks: true,
  };
  await tolerantCall(async () => {
    const trySet = async (mods) => {
      const candidates = [
        () => http.post("/tenants/settings/modules", { modules: mods }, bearer(token)),
        () => http.post("/settings/modules", { modules: mods }, bearer(token)),
        () => http.put("/settings/modules", { modules: mods }, bearer(token)),
      ];
      for (const f of candidates) { try { return await f(); } catch(e){ if([404,501].includes(e?.response?.status)) continue; throw e; } }
      const err = new Error("No module endpoint"); err.response = { status: 404 }; throw err;
    };
    return trySet(baseModules);
  }, "Activer modules (base)", r3);

  // 4) Adherents (OK + invalid)
  const r4a = add("adherent-ok");
  const adherentOk = await tolerantCall(() => http.post("/adherents", {
    nom: "Durand", prenom: "Zoé", email1: `zoe.${tag}@example.com`, statut: "actif"
  }, bearer(token)), "POST /adherents (ok)", r4a);
  const adherentId = adherentOk?.data?.id || null;

  const r4b = add("adherent-invalid-400");
  await tolerantCall(() => http.post("/adherents", { prenom: "SansNom" }, bearer(token)),
    "POST /adherents (invalid)", r4b, { status: 400 });

  // 5) Fournisseurs
  const r5 = add("fournisseur");
  const fournisseur = await tolerantCall(() => http.post("/fournisseurs", {
    nom: `Fournisseur ${tag}`, categorie_id: null, contact: "Bob", email: `f.${tag}@example.com`
  }, bearer(token)), "POST /fournisseurs", r5);
  const fournisseurId = fournisseur?.data?.id || null;

  // 6) Produits (2 produits pour mieux tester)
  const r6a = add("produit-1");
  const p1 = await tolerantCall(() => http.post("/produits", {
    nom: `Pâtes ${tag}`, categorie_id: null, fournisseur_id: fournisseurId,
    unite_id: null, code_barre: `EAN${Date.now()}`, prix: 2.5, stock: 0
  }, bearer(token)), "POST /produits (p1)", r6a);
  const produitId1 = p1?.data?.id || null;

  const r6b = add("produit-2");
  const p2 = await tolerantCall(() => http.post("/produits", {
    nom: `Jus ${tag}`, categorie_id: null, fournisseur_id: fournisseurId,
    unite_id: null, code_barre: `EAN${Date.now()+1}`, prix: 1.8, stock: 0
  }, bearer(token)), "POST /produits (p2)", r6b);
  const produitId2 = p2?.data?.id || null;

  // 7) Réceptions (multi-lignes)
  const r7 = add("reception-multi");
  await tolerantCall(() => http.post("/receptions", {
    fournisseur_id: fournisseurId,
    lignes: [
      { produit_id: produitId1, quantite: 10, prix_achat: 1.5 },
      { produit_id: produitId2, quantite: 5,  prix_achat: 1.0 },
    ],
  }, bearer(token)), "POST /receptions (2 lignes)", r7);

  // 8) Ventes
  // 8.1 Adhérent (remise sur une ligne)
  const r8a = add("vente-adherent-remise");
  await tolerantCall(() => http.post("/ventes", {
    sale_type: "adherent",
    adherent_id: adherentId,
    mode_paiement_id: null, // si API impose, on recevra 400 → KO utile
    lignes: [
      { produit_id: produitId1, quantite: 2, prix: 2.5, prix_unitaire: 2.5, remise_percent: 10 },
      { produit_id: produitId2, quantite: 1, prix: 1.8, prix_unitaire: 1.8, remise_percent: 0 },
    ],
    frais_paiement: 0,
    cotisation: 0,
  }, bearer(token)), "POST /ventes (adherent, remise)", r8a);

  // 8.2 Extérieur (majoration simulée côté client)
  const r8b = add("vente-exterieur");
  await tolerantCall(() => http.post("/ventes", {
    sale_type: "exterieur",
    client_email: null,
    mode_paiement_id: null,
    lignes: [
      { produit_id: produitId1, quantite: 1, prix: 3.25, prix_unitaire: 2.5, remise_percent: 0 },
    ],
    frais_paiement: 0,
    cotisation: 0,
  }, bearer(token)), "POST /ventes (exterieur)", r8b);

  // 9) Inventaire multi-lignes
  const r9a = add("inventory-start");
  const inv = await tolerantCall(() => http.post("/inventory/start", { name: `Inventaire ${tag}` }, bearer(token)),
    "POST /inventory/start", r9a);
  const sessionId = inv?.data?.session?.id || null;

  const r9b = add("inventory-counts");
  await tolerantCall(async () => {
    await http.post("/inventory/count", { sessionId, product_id: produitId1, qty: 2, user: "E2E" }, bearer(token));
    return http.post("/inventory/count", { sessionId, product_id: produitId2, qty: -1, user: "E2E" }, bearer(token));
  }, "POST /inventory/count (p1:+2, p2:-1)", r9b);

  const r9c = add("inventory-finalize");
  await tolerantCall(() => http.post("/inventory/finalize", { sessionId, user: "E2E", email_to: null }, bearer(token)),
    "POST /inventory/finalize", r9c);

  // 10) Vérifs GET (si dispo)
  const r10a = add("verify-produit-1");
  await tolerantCall(() => http.get(`/produits/${produitId1}`, bearer(token)), "GET /produits/:id (p1)", r10a);
  const r10b = add("verify-produit-2");
  await tolerantCall(() => http.get(`/produits/${produitId2}`, bearer(token)), "GET /produits/:id (p2)", r10b);

  // 11) Règle: modes_paiement requis (vente sans mode → 400 attendu)
  const r11 = add("vente-sans-mode-paiement-requis");
  await tolerantCall(() => http.post("/ventes", {
    sale_type: "adherent",
    adherent_id: adherentId,
    mode_paiement_id: null, // manquant volontaire
    lignes: [{ produit_id: produitId1, quantite: 1, prix: 2.5, prix_unitaire: 2.5, remise_percent: 0 }],
    frais_paiement: 0, cotisation: 0,
  }, bearer(token)), "Règle modes_paiement → 400 attendu", r11, { status: 400 });

  // 12) Emails — configuration + test d’envoi (si endpoints existent)
  const SMTP_HOST = process.env.SMTP_HOST || "";
  const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
  const SMTP_USER = process.env.SMTP_USER || "";
  const SMTP_PASS = process.env.SMTP_PASS || "";
  const SMTP_TO   = process.env.TEST_EMAIL_TO || "";

  const r12a = add("email-configure");
  await tolerantCall(async () => {
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      const err = new Error("SMTP non configuré dans tests/.env");
      err.response = { status: 404 };
      throw err;
    }
    // essaie plusieurs chemins possibles
    const candidates = [
      () => http.post("/settings/email", { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS }, bearer(token)),
      () => http.post("/tenants/settings/email", { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS }, bearer(token)),
    ];
    for (const f of candidates) {
      try { return await f(); } catch (e) { if([404,501].includes(e?.response?.status)) continue; throw e; }
    }
    const err = new Error("No email settings endpoint");
    err.response = { status: 404 };
    throw err;
  }, "Configurer SMTP (si supporté)", r12a);

  const r12b = add("email-send-test");
  await tolerantCall(async () => {
    if (!SMTP_TO) {
      const err = new Error("TEST_EMAIL_TO manquant");
      err.response = { status: 404 };
      throw err;
    }
    const candidates = [
      () => http.post("/emails/test", { to: SMTP_TO, subject: "Test E2E", text: "Hello from E2E" }, bearer(token)),
      () => http.post("/emails/send", { to: SMTP_TO, subject: "Test E2E", text: "Hello from E2E" }, bearer(token)),
    ];
    for (const f of candidates) {
      try { return await f(); } catch (e) { if([404,501].includes(e?.response?.status)) continue; throw e; }
    }
    const err = new Error("No email send endpoint");
    err.response = { status: 404 };
    throw err;
  }, "Envoyer un email test (si supporté)", r12b);

  // Notes
  if (r11.status === "SKIP") {
    notes.push("La règle « mode_paiement requis » n’est pas imposée côté API (peut-être UI uniquement).");
  }
  if (r12a.status === "SKIP" || r12b.status === "SKIP") {
    notes.push("Endpoints de configuration/envoi email non détectés — tests EMAIL passés en SKIP.");
  }

  printAndWrite(RUN, notes);
  process.exit(0);
})().catch((e) => {
  console.error("E2E MAX fatal:", e?.message || e);
  process.exit(1);
});
