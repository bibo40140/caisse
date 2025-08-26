// src/main/db/db.js — Schéma local "synchro-first" (sans triggers de stock)
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../../coopaz.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────
// META (version schéma locale)
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS app_meta (
    schema_version INTEGER NOT NULL
  )
`).run();

// ─────────────────────────────────────────────────────────────
// RÉFÉRENTIELS
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS unites (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nom  TEXT UNIQUE NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS familles (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nom  TEXT UNIQUE NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nom         TEXT NOT NULL,
    famille_id  INTEGER,
    UNIQUE(nom, famille_id),
    FOREIGN KEY (famille_id) REFERENCES familles(id) ON DELETE SET NULL
  )
`).run();

// ─────────────────────────────────────────────────────────────
// ACTEURS
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS adherents (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                  TEXT NOT NULL,
    prenom               TEXT NOT NULL,
    email1               TEXT,
    email2               TEXT,
    telephone1           TEXT,
    telephone2           TEXT,
    adresse              TEXT,
    code_postal          TEXT,
    ville                TEXT,
    nb_personnes_foyer   INTEGER,
    tranche_age          TEXT,
    droit_entree         REAL DEFAULT 0,
    date_inscription     TEXT,
    archive              INTEGER DEFAULT 0,
    date_archivage       TEXT,
    date_reactivation    TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS prospects (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nom           TEXT,
    prenom        TEXT,
    email         TEXT,
    telephone     TEXT,
    adresse       TEXT,
    code_postal   TEXT,
    ville         TEXT,
    note          TEXT,
    status        TEXT DEFAULT 'actif',
    date_creation TEXT DEFAULT (datetime('now')),
    adherent_id   INTEGER,
    FOREIGN KEY (adherent_id) REFERENCES adherents(id) ON DELETE SET NULL
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_prospects_email  ON prospects(email)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status)`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS prospects_invitations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id  INTEGER NOT NULL,
    subject      TEXT,
    body_html    TEXT,
    date_reunion TEXT,
    sent_at      TEXT DEFAULT (datetime('now')),
    sent_by      TEXT,
    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_invits_prospect ON prospects_invitations(prospect_id)`).run();

// ─────────────────────────────────────────────────────────────
// FOURNISSEURS / PRODUITS
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS fournisseurs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom          TEXT NOT NULL,
    contact      TEXT,
    email        TEXT,
    telephone    TEXT,
    adresse      TEXT,
    code_postal  TEXT,
    ville        TEXT,
    categorie_id INTEGER,
    referent_id  INTEGER,
    label        TEXT,
    FOREIGN KEY (categorie_id) REFERENCES categories(id),
    FOREIGN KEY (referent_id)  REFERENCES adherents(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS produits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nom            TEXT NOT NULL,
    reference      TEXT UNIQUE NOT NULL,
    prix           REAL NOT NULL,
    stock          INTEGER NOT NULL DEFAULT 0, -- valeur recadrée par le pull depuis Neon
    code_barre     TEXT,
    unite_id       INTEGER,
    fournisseur_id INTEGER,
    categorie_id   INTEGER,
    updated_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (unite_id)       REFERENCES unites(id),
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id),
    FOREIGN KEY (categorie_id)   REFERENCES categories(id)
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_produits_barcode ON produits(code_barre)`).run();

// ─────────────────────────────────────────────────────────────
// MODES DE PAIEMENT / VENTES
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS modes_paiement (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom          TEXT UNIQUE NOT NULL,
    taux_percent REAL DEFAULT 0,
    frais_fixe   REAL DEFAULT 0,
    actif        INTEGER DEFAULT 1
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS ventes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    total            REAL,
    adherent_id      INTEGER,
    date_vente       TEXT DEFAULT (datetime('now','localtime')),
    mode_paiement_id INTEGER,
    frais_paiement   REAL DEFAULT 0,
    sale_type        TEXT NOT NULL DEFAULT 'adherent',   -- 'adherent' | 'exterieur' | 'prospect'
    client_email     TEXT,
    updated_at       TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (adherent_id)      REFERENCES adherents(id),
    FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date_vente)`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS lignes_vente (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    vente_id       INTEGER NOT NULL,
    produit_id     INTEGER NOT NULL,
    quantite       REAL NOT NULL,
    prix           REAL NOT NULL,          -- prix appliqué (après remise / marge)
    prix_unitaire  REAL,                   -- PU avant remise
    remise_percent REAL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (vente_id)   REFERENCES ventes(id)     ON DELETE CASCADE,
    FOREIGN KEY (produit_id) REFERENCES produits(id)   ON DELETE CASCADE
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente ON lignes_vente(vente_id)`).run();

// ─────────────────────────────────────────────────────────────
// COTISATIONS
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS cotisations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    adherent_id   INTEGER NOT NULL,
    mois          TEXT NOT NULL, -- 'YYYY-MM'
    montant       REAL NOT NULL,
    date_paiement TEXT DEFAULT (date('now')),
    FOREIGN KEY (adherent_id) REFERENCES adherents(id)
  )
`).run();

// ─────────────────────────────────────────────────────────────
// RÉCEPTIONS
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS receptions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fournisseur_id INTEGER,
    date           TEXT DEFAULT (datetime('now','localtime')),
    reference      TEXT,
    updated_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS lignes_reception (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reception_id   INTEGER NOT NULL,
    produit_id     INTEGER NOT NULL,
    quantite       REAL NOT NULL,
    prix_unitaire  REAL,
    updated_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
    FOREIGN KEY (produit_id)   REFERENCES produits(id)   ON DELETE CASCADE
  )
`).run();

// ─────────────────────────────────────────────────────────────
// JOURNAL D’OPÉRATIONS (LOCAL → pour push vers Neon)
// ─────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS ops_queue (
    id           TEXT PRIMARY KEY,                  -- UUID
    device_id    TEXT NOT NULL,                     -- identifiant du poste
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    op_type      TEXT NOT NULL,                     -- ex: sale.created, sale.line_added, reception.line_added
    entity_type  TEXT,                              -- ex: vente, ligne_vente, produit...
    entity_id    TEXT,                              -- id local (integer) ou uuid
    payload_json TEXT NOT NULL,                     -- JSON.stringify(...)
    sent_at      TEXT,
    ack          INTEGER NOT NULL DEFAULT 0         -- 0 = pas confirmé, 1 = confirmé par le serveur
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_ops_queue_ack ON ops_queue(ack)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_ops_queue_created ON ops_queue(created_at)`).run();

// ─────────────────────────────────────────────────────────────
// ⚠️ Nettoyage : supprimer d’anciens triggers locaux de stock
// (évite le double comptage; le stock est recalé par le PULL)
// ─────────────────────────────────────────────────────────────
db.exec(`
  DROP TRIGGER IF EXISTS trg_sm_ai;
  DROP TRIGGER IF EXISTS trg_sm_ad;
  DROP TRIGGER IF EXISTS trg_sm_au;
  DROP TRIGGER IF EXISTS trg_lv_ai;
  DROP TRIGGER IF EXISTS trg_lv_ad;
  DROP TRIGGER IF EXISTS trg_lv_au;
  DROP TRIGGER IF EXISTS trg_lr_ai;
  DROP TRIGGER IF EXISTS trg_lr_ad;
  DROP TRIGGER IF EXISTS trg_lr_au;
`);

// ─────────────────────────────────────────────────────────────
// SEEDS
// ─────────────────────────────────────────────────────────────
(function seedUnites() {
  const have = db.prepare('SELECT nom FROM unites').all().map(x => (x.nom || '').toLowerCase());
  const ins  = db.prepare('INSERT INTO unites (nom) VALUES (?)');
  ['kg','litre','pièce'].forEach(n => { if (!have.includes(n)) ins.run(n); });
})();

const DEFAULT_TREE = [
  { famille: 'Fruits & Légumes (frais)', cats: ['Fruits frais','Légumes frais','Herbes & aromates','Champignons','Pommes de terre & tubercules','Fruits secs & oléagineux'] },
  { famille: 'Crèmerie & Œufs', cats: ['Lait & boissons lactées','Yaourts & desserts lactés','Beurre & matières grasses','Crèmes & fromages blancs','Fromages','Œufs'] },
  { famille: 'Boucherie / Charcuterie / Poissonnerie', cats: ['Viande boeuf & agneau','Viande porc','Viande autres','Volaille','Charcuterie','Poisson & fruits de mer','Alternatives végétales'] },
  { famille: 'Épicerie salée', cats: ['Pâtes, riz & céréales','Légumineuses','Conserves & bocaux','Sauces, condiments & épices','Huiles & vinaigres','Apéro salé'] },
  { famille: 'Épicerie sucrée', cats: ['Biscuits & gâteaux','Chocolat & confiseries','Confitures & pâtes à tartiner','Sucres & farines','Aides pâtisserie & levures','Miel & sirops'] },
  { famille: 'Boulangerie', cats: ['Pains & viennoiseries','Biscottes & pains grillés'] },
  { famille: 'Boissons', cats: ['Eaux','Sodas','Jus & nectars','Bières & cidres','Vins & spiritueux','Boissons chaudes'] },
  { famille: 'Surgelés', cats: ['Surgelés salés','Surgelés sucrés','Glaces'] },
  { famille: 'Hygiène & Entretien', cats: ['Hygiène','Beauté','Papeterie','Entretien','Vaisselle'] },
  { famille: 'VRAC', cats: ['Vrac salé','Vrac sucré'] },
];

(function seedFamiliesAndCategories() {
  const haveFam = db.prepare('SELECT COUNT(*) AS n FROM familles').get().n;
  if (haveFam > 0) return;
  const insFam  = db.prepare('INSERT INTO familles (nom) VALUES (?)');
  const findFam = db.prepare('SELECT id FROM familles WHERE nom = ?');
  const insCat  = db.prepare('INSERT INTO categories (nom, famille_id) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const grp of DEFAULT_TREE) {
      insFam.run(grp.famille);
      const famId = findFam.get(grp.famille).id;
      for (const c of grp.cats) insCat.run(c, famId);
    }
  });
  tx();
})();

(function seedModesPaiement() {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM modes_paiement`).get().n;
  if (count > 0) return;
  const ins = db.prepare(`INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif) VALUES (?, ?, ?, 1)`);
  ins.run('Espèces', 0, 0);
  ins.run('CB', 0.55, 0);
  ins.run('Virement', 0, 0);
})();

// META version
const cur = db.prepare('SELECT COUNT(*) AS n FROM app_meta').get().n;
if (cur === 0) db.prepare('INSERT INTO app_meta (schema_version) VALUES (2)').run();
else db.prepare('UPDATE app_meta SET schema_version = 2').run();

module.exports = db;
