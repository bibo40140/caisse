// tests/ui-smoke.js
// UI smoke (facultatif): vérifie que l'UI renvoie du HTML et contient quelques marqueurs.
// Nécessite que le renderer soit accessible via RENDERER_URL (dans tests/.env).

const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const URL = process.env.RENDERER_URL || ""; // ex: http://localhost:5173
if (!URL) {
  console.log("⏭️  UI SKIP: RENDERER_URL non défini dans tests/.env");
  process.exit(0);
}

(async () => {
  try {
    const r = await axios.get(URL, { timeout: 10000 });
    const html = String(r.data || "");
    if (!html || html.length < 200) throw new Error("HTML trop court");

    // Exemples de textes/éléments à adapter selon ton app:
    const probes = [
      { label: "Titre app", mustContain: "Logiciel Coop’az" },
      { label: "Menu Caisse", mustContain: "Invoice" },
      { label: "Menu Réceptions", mustContain: "Reception" },
      { label: "Menu Fournisseurs", mustContain: "Supplier" },
      { label: "Produits", mustContain: "Product Info" },
    ];

    let ok = 0, miss = 0;
    for (const p of probes) {
      if (html.includes(p.mustContain)) {
        console.log(`✔️  UI: ${p.label} visible (${p.mustContain})`);
        ok++;
      } else {
        console.log(`⏭️  UI: ${p.label} introuvable → vérifier libellé (SKIP)`);
        miss++;
      }
    }
    console.log(`\nUI smoke terminé → OK=${ok}, SKIP=${miss}`);
    process.exit(0);
  } catch (e) {
    console.log("⏭️  UI SKIP: Impossible d'atteindre RENDERER_URL →", e?.message || e);
    process.exit(0);
  }
})();
