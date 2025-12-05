# Schéma de Référence Harmonisé - Local (SQLite) vs Neon (PostgreSQL)

**Date:** 2025-12-05  
**Objectif:** Définir un schéma de référence cohérent pour éliminer les doublons et harmoniser les structures local/Neon.

---

## Principes directeurs

1. **Pas de `tenant_id` en local** : Le tenant est implicite (nom du fichier `tenant_xxx.db`)
2. **`remote_uuid`** : Colonne de mapping local → UUID Neon (présente dans toutes les tables principales côté local)
3. **Timestamps unifiés** :
   - `created_at` : Date/heure de création (immutable)
   - `updated_at` : Date/heure de dernière modification (mis à jour automatiquement)
   - **Supprimer** : `date_vente`, `date_creation`, `date_archivage`, etc. → remplacer par `created_at`/`updated_at` + colonnes métier spécifiques si besoin
4. **Types cohérents** :
   - Local (SQLite) : `INTEGER` (PK auto), `REAL` (nombres), `TEXT` (dates ISO8601), `INTEGER` (booleans)
   - Neon (PostgreSQL) : `uuid` (PK), `numeric`, `timestamptz`, `boolean`, `jsonb`
5. **Colonnes métier spécifiques** : Garder uniquement ce qui est utilisé dans le code

---

## 1. Tables de référence (référentiels)

### 1.1 `unites`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`       | TEXT UNIQUE         | text NOT NULL          | Oui         | Nom de l'unité (ex: "kg", "L") |
| `remote_uuid` | TEXT UNIQUE       | ❌ Absent              | Non         | Mapping local → Neon |

**Contraintes:**
- Local : `UNIQUE (nom)`
- Neon : `UNIQUE (tenant_id, nom)`, FK `tenant_id → tenants(id)`

---

### 1.2 `familles`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`       | TEXT UNIQUE         | text NOT NULL          | Oui         | Nom de la famille (ex: "Épicerie") |
| `remote_uuid` | TEXT UNIQUE       | ❌ Absent              | Non         | Mapping local → Neon |

**Contraintes:**
- Local : `UNIQUE (nom)`
- Neon : `UNIQUE (tenant_id, nom)`, FK `tenant_id → tenants(id)`

---

### 1.3 `categories`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`       | TEXT NOT NULL       | text NOT NULL          | Oui         | Nom de la catégorie |
| `famille_id`| INTEGER             | uuid                   | Non         | FK vers familles |
| `remote_uuid` | TEXT UNIQUE       | ❌ Absent              | Non         | Mapping local → Neon |

**Contraintes:**
- Local : `UNIQUE (nom, famille_id)`, FK `famille_id → familles(id)`
- Neon : `UNIQUE (tenant_id, nom)`, FK `famille_id → familles(id)`, FK `tenant_id → tenants(id)`

---

### 1.4 `modes_paiement`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`       | TEXT UNIQUE         | text NOT NULL          | Oui         | Nom du mode (ex: "Espèces", "Carte") |
| `taux_percent` | REAL DEFAULT 0   | numeric(8,3) DEFAULT 0 | Non         | Taux de commission (%) |
| `frais_fixe`| REAL DEFAULT 0      | numeric(12,2) DEFAULT 0| Non         | Frais fixes |
| `actif`     | INTEGER DEFAULT 1   | boolean DEFAULT true   | Non         | Actif ou non |
| `remote_uuid` | TEXT UNIQUE       | ❌ Absent              | Non         | Mapping local → Neon |

**Contraintes:**
- Local : `UNIQUE (nom)`
- Neon : `UNIQUE (tenant_id, nom)`, FK `tenant_id → tenants(id)`

---

## 2. Tables entités principales

### 2.1 `adherents`

| Colonne             | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|--------------------|---------------------|------------------------|-------------|-------|
| `id`               | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`        | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`              | TEXT NOT NULL       | text                   | Non         | Nom |
| `prenom`           | TEXT NOT NULL       | text                   | Non         | Prénom |
| `email1`           | TEXT                | text                   | Non         | Email principal |
| `email2`           | TEXT                | text                   | Non         | Email secondaire |
| `telephone1`       | TEXT                | text                   | Non         | Téléphone 1 |
| `telephone2`       | TEXT                | text                   | Non         | Téléphone 2 |
| `adresse`          | TEXT                | text                   | Non         | Adresse |
| `code_postal`      | TEXT                | text                   | Non         | Code postal |
| `ville`            | TEXT                | text                   | Non         | Ville |
| `nb_personnes_foyer` | INTEGER           | int                    | Non         | Nombre de personnes |
| `tranche_age`      | TEXT                | text                   | Non         | Tranche d'âge |
| `statut`           | TEXT DEFAULT 'actif'| ❌ Absent              | Non (local) | Statut de l'adhérent |
| `droit_entree`     | REAL DEFAULT 0      | numeric(12,2)          | Non         | Droit d'entrée |
| `date_inscription` | TEXT                | date                   | Non         | **🔥 GARDER** : Date d'inscription (métier) |
| `archive`          | INTEGER DEFAULT 0   | boolean                | Non         | Archivé ou non |
| `date_archivage`   | TEXT                | date                   | Non         | **🔥 GARDER** : Date d'archivage (métier) |
| `date_reactivation`| TEXT                | date                   | Non         | **🔥 GARDER** : Date de réactivation (métier) |
| `remote_uuid`      | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER (harmonisation):**
- ❌ Aucune pour l'instant (les dates métier sont justifiées)

**🔥 Colonnes à SUPPRIMER:**
- Aucune (dates métier spécifiques justifiées)

**Contraintes:**
- Neon : FK `tenant_id → tenants(id)`

---

### 2.2 `fournisseurs`

| Colonne         | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|----------------|---------------------|------------------------|-------------|-------|
| `id`           | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`    | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`          | TEXT NOT NULL       | text NOT NULL          | Oui         | Nom du fournisseur |
| `contact`      | TEXT                | text                   | Non         | Contact |
| `email`        | TEXT                | text                   | Non         | Email |
| `telephone`    | TEXT                | text                   | Non         | Téléphone |
| `adresse`      | TEXT                | text                   | Non         | Adresse |
| `code_postal`  | TEXT                | text                   | Non         | Code postal |
| `ville`        | TEXT                | text                   | Non         | Ville |
| `categorie_id` | INTEGER             | uuid                   | Non         | FK vers categories |
| `referent_id`  | INTEGER             | ❌ Absent              | Non         | FK vers adherents (local only?) |
| `label`        | TEXT                | text                   | Non         | Label/tag |
| `remote_uuid`  | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER:**
- Neon : `referent_id` (uuid, FK vers adherents) si utilisé côté local

**🔥 Colonnes à SUPPRIMER:**
- Aucune

**Contraintes:**
- Local : FK `categorie_id → categories(id)`, FK `referent_id → adherents(id)`
- Neon : `UNIQUE (tenant_id, nom)`, FK `categorie_id → categories(id)`, FK `tenant_id → tenants(id)`

---

### 2.3 `produits`

| Colonne         | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|----------------|---------------------|------------------------|-------------|-------|
| `id`           | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`    | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `nom`          | TEXT NOT NULL       | text NOT NULL          | Oui         | Nom du produit |
| `reference`    | TEXT UNIQUE         | text                   | Oui         | Référence unique |
| `prix`         | REAL NOT NULL       | numeric(12,2) NOT NULL | Oui         | Prix unitaire |
| `stock`        | REAL NOT NULL DEFAULT 0 | numeric(14,3) NOT NULL DEFAULT 0 | Oui | Stock actuel |
| `code_barre`   | TEXT                | text                   | Non         | Code-barres |
| `unite_id`     | INTEGER             | uuid                   | Non         | FK vers unites |
| `fournisseur_id` | INTEGER           | uuid                   | Non         | FK vers fournisseurs |
| `categorie_id` | INTEGER             | uuid                   | Non         | FK vers categories |
| `deleted`      | INTEGER DEFAULT 0   | boolean DEFAULT false  | Non         | Soft delete |
| `updated_at`   | TEXT DEFAULT (...)  | timestamptz DEFAULT now() | Non      | **🔥 GARDER** : Date de modification |
| `remote_uuid`  | TEXT                | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER:**
- Local : `created_at` (TEXT, pour cohérence)
- Neon : `created_at` (timestamptz, pour cohérence)

**🔥 Colonnes à HARMONISER:**
- ✅ `updated_at` déjà présent des deux côtés

**Contraintes:**
- Local : `UNIQUE (reference)`, FK `unite_id`, `fournisseur_id`, `categorie_id`
- Neon : `UNIQUE (tenant_id, reference)`, `UNIQUE (tenant_id, code_barre)`, FKs

---

### 2.4 `ventes`

| Colonne           | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|------------------|---------------------|------------------------|-------------|-------|
| `id`             | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`      | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `total`          | REAL                | numeric(12,2)          | Non         | Total de la vente |
| `adherent_id`    | INTEGER             | uuid                   | Non         | FK vers adherents |
| `mode_paiement_id` | INTEGER           | uuid                   | Non         | FK vers modes_paiement |
| `sale_type`      | TEXT DEFAULT 'adherent' | text NOT NULL      | Oui         | Type de vente |
| `client_email`   | TEXT                | text                   | Non         | Email client (si non adhérent) |
| `frais_paiement` | REAL DEFAULT 0      | numeric(12,2)          | Non         | Frais de paiement |
| `cotisation`     | REAL DEFAULT 0      | numeric(12,2)          | Non         | Cotisation |
| `date_vente`     | TEXT DEFAULT (...)  | timestamptz DEFAULT now() | Non      | **🔥 REMPLACER par `created_at`** |
| `updated_at`     | TEXT DEFAULT (...)  | ❌ Absent              | Non         | Date de modification |
| `remote_uuid`    | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER/HARMONISER:**
- Neon : `updated_at` (timestamptz)
- **🔥 Neon : `created_at` (renommer `date_vente` en `created_at`)** ou garder `date_vente` comme colonne métier + ajouter `created_at`/`updated_at`

**🔥 Décision à prendre:**
- **Option A** : `date_vente` = colonne métier (date de la vente, peut être modifiée par l'utilisateur), `created_at` = timestamp système (création enregistrement), `updated_at` = dernière modif
- **Option B** : `date_vente` = alias de `created_at`, supprimer la redondance

**Recommandation : Option A** (garder `date_vente` comme métier, ajouter `created_at`/`updated_at`)

**Contraintes:**
- Local : FK `adherent_id`, `mode_paiement_id`
- Neon : FK `adherent_id`, `mode_paiement_id`, `tenant_id`

---

### 2.5 `lignes_vente`

| Colonne         | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|----------------|---------------------|------------------------|-------------|-------|
| `id`           | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`    | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `vente_id`     | INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers ventes |
| `produit_id`   | INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers produits |
| `quantite`     | REAL NOT NULL       | numeric(14,3) NOT NULL | Oui         | Quantité vendue |
| `prix`         | REAL NOT NULL       | numeric(12,2) NOT NULL | Oui         | Prix total ligne |
| `prix_unitaire`| REAL                | numeric(12,2)          | Non         | Prix unitaire |
| `remise_percent`| REAL DEFAULT 0     | numeric(5,2) DEFAULT 0 | Non         | Remise en % |
| `updated_at`   | TEXT DEFAULT (...)  | ❌ Absent              | Non         | Date de modification |
| `remote_uuid`  | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER:**
- Local : `created_at` (TEXT)
- Neon : `created_at` (timestamptz), `updated_at` (timestamptz)

**Contraintes:**
- Local : FK `vente_id → ventes(id) ON DELETE CASCADE`, FK `produit_id → produits(id) ON DELETE CASCADE`
- Neon : FK `vente_id`, `produit_id`, `tenant_id`

---

### 2.6 `receptions`

| Colonne         | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|----------------|---------------------|------------------------|-------------|-------|
| `id`           | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`    | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `fournisseur_id` | INTEGER           | uuid                   | Non         | FK vers fournisseurs (pas de FK strict en local) |
| `date`         | TEXT DEFAULT (...)  | timestamptz DEFAULT now() | Non      | **🔥 RENOMMER en `created_at`** |
| `reference`    | TEXT                | text                   | Non         | Référence de la réception |
| `updated_at`   | TEXT DEFAULT (...)  | ❌ Absent              | Non         | Date de modification |
| `remote_uuid`  | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER/HARMONISER:**
- Neon : `updated_at` (timestamptz)
- **🔥 Renommer `date` → `created_at` des deux côtés**

**Contraintes:**
- Local : Pas de FK sur `fournisseur_id` (module optionnel)
- Neon : FK `fournisseur_id → fournisseurs(id)`, `tenant_id → tenants(id)`

---

### 2.7 `lignes_reception`

| Colonne         | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|----------------|---------------------|------------------------|-------------|-------|
| `id`           | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id`    | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `reception_id` | INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers receptions |
| `produit_id`   | INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers produits |
| `quantite`     | REAL NOT NULL       | numeric(14,3) NOT NULL | Oui         | Quantité reçue |
| `prix_unitaire`| REAL                | numeric(12,2)          | Non         | Prix unitaire |
| `updated_at`   | TEXT DEFAULT (...)  | ❌ Absent              | Non         | Date de modification |
| `remote_uuid`  | TEXT UNIQUE         | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER:**
- Local : `created_at` (TEXT)
- Neon : `created_at` (timestamptz), `updated_at` (timestamptz)

**Contraintes:**
- Local : FK `reception_id → receptions(id) ON DELETE CASCADE`, FK `produit_id → produits(id) ON DELETE CASCADE`
- Neon : FK `reception_id`, `produit_id`, `tenant_id`

---

### 2.8 `stock_movements`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | ❌ Absent           | uuid PK                | Oui (Neon)  | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `produit_id`| INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers produits |
| `delta`     | ❌ Absent (local)   | numeric(14,3) NOT NULL | Oui (Neon)  | Variation de stock |
| `source`    | ❌ Absent (local)   | text NOT NULL          | Oui (Neon)  | Source du mouvement |
| `source_id` | ❌ Absent (local)   | text                   | Non         | ID de la source |
| `created_at`| TEXT DEFAULT (...)  | timestamptz DEFAULT now() | Non      | Date de création |

**⚠️ ATTENTION : Table incomplète côté local !**

**✅ Colonnes à AJOUTER (local):**
- `id` (INTEGER PK AUTO)
- `delta` (REAL NOT NULL)
- `source` (TEXT NOT NULL)
- `source_id` (TEXT)

**🔥 Décision :**
- ✅ Harmoniser en ajoutant toutes les colonnes côté local

**Contraintes:**
- Local : FK `produit_id → produits(id)`
- Neon : FK `produit_id`, `tenant_id`, `UNIQUE (tenant_id, source_id) WHERE source_id IS NOT NULL`

---

## 3. Tables inventaire

### 3.1 `inventory_sessions`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | uuid PK                | Oui         | Clé primaire |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `name`      | TEXT                | text NOT NULL          | Non/Oui     | Nom de la session |
| `user`      | ❌ Absent (local)   | text                   | Non         | Utilisateur |
| `notes`     | ❌ Absent (local)   | text                   | Non         | Notes |
| `status`    | TEXT DEFAULT 'open' | text DEFAULT 'open'    | Non         | Statut |
| `started_at`| TEXT DEFAULT (...)  | timestamptz DEFAULT now() | Non      | Date de début |
| `ended_at`  | TEXT                | timestamptz            | Non         | Date de fin |
| `remote_uuid` | TEXT UNIQUE       | ❌ Absent              | Non         | Mapping local → Neon |

**✅ Colonnes à AJOUTER (local):**
- `user` (TEXT)
- `notes` (TEXT)

**Contraintes:**
- Neon : FK `tenant_id → tenants(id)`

---

### 3.2 `inventory_counts`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `id`        | INTEGER PK AUTO     | ❌ PK composite        | Oui (local) | Clé primaire locale |
| `session_id`| INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers inventory_sessions |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `produit_id`| INTEGER NOT NULL    | uuid NOT NULL          | Oui         | FK vers produits |
| `device_id` | TEXT                | text NOT NULL          | Non/Oui     | ID de l'appareil |
| `user`      | TEXT                | text                   | Non         | Utilisateur |
| `qty`       | REAL NOT NULL       | numeric(14,3) NOT NULL | Oui         | Quantité comptée |
| `created_at`| TEXT DEFAULT (...)  | ❌ Absent              | Non         | Date de création (local) |
| `updated_at`| ❌ Absent (local)   | timestamptz DEFAULT now() | Non      | Date de modification (Neon) |

**✅ Colonnes à HARMONISER:**
- Local : Ajouter `updated_at` (TEXT)
- Neon : Ajouter `created_at` (timestamptz)

**Contraintes:**
- Local : FK `session_id → inventory_sessions(id) ON DELETE CASCADE`
- Neon : PK `(session_id, produit_id, device_id)`, FK `session_id`, `produit_id`, `tenant_id`

---

### 3.3 `inventory_snapshot`

| Colonne      | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|-------------|---------------------|------------------------|-------------|-------|
| `session_id`| ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | FK vers inventory_sessions |
| `tenant_id` | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `produit_id`| ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | FK vers produits |
| `stock_start`| ❌ Absent          | numeric(14,3)          | Non         | Stock de départ |
| `unit_cost` | ❌ Absent           | numeric(12,2)          | Non         | Coût unitaire |

**⚠️ Table absente côté local !**

**✅ Colonnes à AJOUTER (local):**
- Créer la table complète

**Contraintes:**
- Neon : PK `(session_id, produit_id)`, FK `session_id`, `produit_id`, `tenant_id`

---

### 3.4 `inventory_adjust`

| Colonne        | Type Local (SQLite) | Type Neon (PostgreSQL) | Obligatoire | Notes |
|---------------|---------------------|------------------------|-------------|-------|
| `session_id`  | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | FK vers inventory_sessions |
| `tenant_id`   | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | Multi-tenant |
| `produit_id`  | ❌ Absent           | uuid NOT NULL          | Oui (Neon)  | FK vers produits |
| `stock_start` | ❌ Absent           | numeric(14,3)          | Non         | Stock de départ |
| `counted_total`| ❌ Absent          | numeric(14,3)          | Non         | Total compté |
| `delta`       | ❌ Absent           | numeric(14,3)          | Non         | Écart |
| `unit_cost`   | ❌ Absent           | numeric(12,2)          | Non         | Coût unitaire |
| `delta_value` | ❌ Absent           | numeric(14,3)          | Non         | Valeur de l'écart |
| `created_at`  | ❌ Absent           | timestamptz DEFAULT now() | Non      | Date de création |

**⚠️ Table absente côté local !**

**✅ Colonnes à AJOUTER (local):**
- Créer la table complète

**Contraintes:**
- Neon : PK `(session_id, tenant_id, produit_id)`, FK `session_id`, `produit_id`, `tenant_id`

---

## 4. Tables locales uniquement (UI caisse, sync)

### 4.1 `carts` (Paniers, local only)

| Colonne           | Type Local (SQLite) | Notes |
|------------------|---------------------|-------|
| `id`             | TEXT PK             | ID du panier (UUID généré côté client) |
| `name`           | TEXT                | Nom du panier |
| `sale_type`      | TEXT DEFAULT 'adherent' | Type de vente |
| `adherent_id`    | INTEGER             | FK vers adherents (pas de FK strict) |
| `prospect_id`    | INTEGER             | FK vers prospects |
| `client_email`   | TEXT                | Email client |
| `mode_paiement_id` | INTEGER           | FK vers modes_paiement |
| `meta`           | TEXT                | Métadonnées JSON |
| `created_at`     | INTEGER NOT NULL    | **🔥 Type incohérent : INTEGER au lieu de TEXT** |
| `updated_at`     | INTEGER NOT NULL    | **🔥 Type incohérent : INTEGER au lieu de TEXT** |
| `status`         | TEXT DEFAULT 'open' | Statut du panier |

**✅ Colonnes à HARMONISER:**
- `created_at` : Passer de INTEGER à TEXT (ou garder INTEGER si c'est un timestamp Unix)
- `updated_at` : Passer de INTEGER à TEXT (ou garder INTEGER si c'est un timestamp Unix)

**Contraintes:**
- FK `mode_paiement_id → modes_paiement(id)`

---

### 4.2 `cart_items` (Lignes de panier, local only)

| Colonne          | Type Local (SQLite) | Notes |
|-----------------|---------------------|-------|
| `id`            | INTEGER PK AUTO     | Clé primaire |
| `cart_id`       | TEXT NOT NULL       | FK vers carts |
| `produit_id`    | INTEGER             | FK vers produits (pas de FK strict) |
| `nom`           | TEXT                | Nom du produit (copie) |
| `fournisseur_nom` | TEXT              | Nom du fournisseur (copie) |
| `unite`         | TEXT                | Unité (copie) |
| `prix`          | REAL                | Prix |
| `quantite`      | REAL                | Quantité |
| `remise_percent`| REAL                | Remise en % |
| `type`          | TEXT                | Type : 'produit', 'cotisation', 'acompte' |
| `created_at`    | INTEGER NOT NULL    | **🔥 Type incohérent : INTEGER au lieu de TEXT** |
| `updated_at`    | INTEGER NOT NULL    | **🔥 Type incohérent : INTEGER au lieu de TEXT** |

**✅ Colonnes à HARMONISER:**
- `created_at` : Passer de INTEGER à TEXT (ou garder INTEGER si timestamp Unix)
- `updated_at` : Passer de INTEGER à TEXT (ou garder INTEGER si timestamp Unix)

**Contraintes:**
- FK `cart_id → carts(id) ON DELETE CASCADE`

---

### 4.3 `ops_queue` (File d'attente de sync, local only)

| Colonne       | Type Local (SQLite) | Notes |
|--------------|---------------------|-------|
| `id`         | TEXT PK             | UUID client |
| `device_id`  | TEXT NOT NULL       | ID de l'appareil |
| `created_at` | TEXT DEFAULT (...)  | Date de création |
| `op_type`    | TEXT NOT NULL       | Type d'opération |
| `entity_type`| TEXT                | Type d'entité |
| `entity_id`  | TEXT                | ID de l'entité |
| `payload_json` | TEXT NOT NULL     | Payload JSON |
| `sent_at`    | TEXT                | Date d'envoi |
| `ack`        | INTEGER DEFAULT 0   | Accusé de réception |
| `retry_count`| INTEGER DEFAULT 0   | Nombre de tentatives |
| `last_error` | TEXT                | Dernière erreur |
| `failed_at`  | TEXT                | Date d'échec |

**✅ Colonnes OK**

---

### 4.4 `sync_state` (État de synchronisation, local only)

| Colonne        | Type Local (SQLite) | Notes |
|---------------|---------------------|-------|
| `entity_type` | TEXT PK             | Type d'entité (ex: 'produits', 'ventes') |
| `last_sync_at`| TEXT NOT NULL       | Timestamp du dernier pull |
| `last_sync_ok`| INTEGER DEFAULT 1   | 1 si succès, 0 si erreur |
| `updated_at`  | TEXT DEFAULT (...)  | Date de modification |

**✅ Colonnes OK**

---

### 4.5 `prospects` (Local only, optionnel)

| Colonne         | Type Local (SQLite) | Notes |
|----------------|---------------------|-------|
| `id`           | INTEGER PK AUTO     | Clé primaire |
| `nom`          | TEXT                | Nom |
| `prenom`       | TEXT                | Prénom |
| `email`        | TEXT                | Email |
| `telephone`    | TEXT                | Téléphone |
| `adresse`      | TEXT                | Adresse |
| `code_postal`  | TEXT                | Code postal |
| `ville`        | TEXT                | Ville |
| `note`         | TEXT                | Note |
| `status`       | TEXT DEFAULT 'actif'| Statut |
| `date_creation`| TEXT DEFAULT (...)  | **🔥 RENOMMER en `created_at`** |
| `adherent_id`  | INTEGER             | FK vers adherents |

**✅ Colonnes à HARMONISER:**
- Renommer `date_creation` → `created_at`

**Contraintes:**
- FK `adherent_id → adherents(id) ON DELETE SET NULL`

---

## 5. Tables Neon uniquement (multi-tenant, système)

### 5.1 `tenants`

| Colonne      | Type Neon (PostgreSQL) | Notes |
|-------------|------------------------|-------|
| `id`        | uuid PK                | Clé primaire |
| `name`      | text NOT NULL          | Nom du tenant |
| `created_at`| timestamptz DEFAULT now() | Date de création |

---

### 5.2 `users`

| Colonne        | Type Neon (PostgreSQL) | Notes |
|---------------|------------------------|-------|
| `id`          | uuid PK                | Clé primaire |
| `tenant_id`   | uuid NOT NULL          | FK vers tenants |
| `email`       | text NOT NULL          | Email |
| `password_hash` | text NOT NULL        | Hash du mot de passe |
| `role`        | text DEFAULT 'admin'   | Rôle |
| `created_at`  | timestamptz DEFAULT now() | Date de création |

**Contraintes:**
- `UNIQUE (tenant_id, email)`
- FK `tenant_id → tenants(id) ON DELETE CASCADE`

---

### 5.3 `tenant_settings` (Neon : multi-tenant, Local : clé/valeur simple)

| Colonne        | Type Neon (PostgreSQL) | Type Local (SQLite) | Notes |
|---------------|------------------------|---------------------|-------|
| `tenant_id`   | uuid PK                | ❌ Absent           | Clé primaire (Neon) |
| `key`         | ❌ Absent              | TEXT PK             | Clé (Local) |
| `value_json`  | ❌ Absent              | TEXT                | Valeur JSON (Local) |
| `company_name`| text                   | ❌ Absent           | Nom de l'entreprise (Neon) |
| `logo_url`    | text                   | ❌ Absent           | URL du logo (Neon) |
| `smtp_host`, `smtp_port`, ... | text, int, ...     | ❌ Absent           | Config SMTP (Neon) |
| `modules`     | jsonb DEFAULT '{}'     | ❌ Absent           | Modules actifs (Neon) |
| `modules_json`| jsonb DEFAULT '{}'     | ❌ Absent           | Modules JSON (Neon) |
| `smtp_json`   | jsonb DEFAULT '{}'     | ❌ Absent           | SMTP JSON (Neon) |
| `onboarded`   | boolean DEFAULT false  | ❌ Absent           | Onboarding (Neon) |
| `updated_at`  | timestamptz DEFAULT now() | TEXT DEFAULT (...) | Date de modification |

**⚠️ Structure complètement différente !**

**Recommandation :**
- **Local** : Garder la structure clé/valeur simple (adapté à SQLite)
- **Neon** : Garder la structure multi-colonnes (adapté à PostgreSQL multi-tenant)
- Pas besoin d'harmonisation (usages différents)

---

### 5.4 `ops` (Journal d'opérations, Neon uniquement)

| Colonne      | Type Neon (PostgreSQL) | Notes |
|-------------|------------------------|-------|
| `id`        | uuid PK                | UUID de l'opération (généré par le client) |
| `tenant_id` | uuid NOT NULL          | FK vers tenants |
| `device_id` | text NOT NULL          | ID de l'appareil |
| `op_type`   | text NOT NULL          | Type d'opération |
| `entity_type` | text                 | Type d'entité |
| `entity_id` | text                   | ID de l'entité |
| `payload`   | jsonb                  | Payload JSON |
| `applied_at`| timestamptz            | Date d'application |

**Contraintes:**
- FK `tenant_id → tenants(id) ON DELETE CASCADE`

---

## 6. Résumé des actions recommandées

### 6.1 Colonnes redondantes ou obsolètes à supprimer

| Table          | Colonne          | Action                              | Justification |
|---------------|------------------|-------------------------------------|---------------|
| ❌ Aucune pour l'instant | | Les dates métier sont justifiées | |

### 6.2 Colonnes à ajouter (harmonisation)

| Table               | Colonne       | Côté     | Type              | Notes |
|--------------------|--------------|---------|-------------------|-------|
| `produits`         | `created_at` | Local   | TEXT              | Pour cohérence |
| `produits`         | `created_at` | Neon    | timestamptz       | Pour cohérence |
| `ventes`           | `created_at` | Local   | TEXT              | Système (création) |
| `ventes`           | `updated_at` | Neon    | timestamptz       | Système (modif) |
| `lignes_vente`     | `created_at` | Local   | TEXT              | Pour cohérence |
| `lignes_vente`     | `created_at`, `updated_at` | Neon | timestamptz | Pour cohérence |
| `receptions`       | `updated_at` | Neon    | timestamptz       | Pour cohérence |
| `lignes_reception` | `created_at` | Local   | TEXT              | Pour cohérence |
| `lignes_reception` | `created_at`, `updated_at` | Neon | timestamptz | Pour cohérence |
| `stock_movements`  | `id`, `delta`, `source`, `source_id` | Local | INTEGER PK, REAL, TEXT, TEXT | Table incomplète ! |
| `inventory_sessions` | `user`, `notes` | Local | TEXT, TEXT     | Manquants |
| `inventory_counts` | `updated_at` | Local   | TEXT              | Pour cohérence |
| `inventory_counts` | `created_at` | Neon    | timestamptz       | Pour cohérence |
| `inventory_snapshot` | Toute la table | Local | Créer            | Table manquante |
| `inventory_adjust` | Toute la table | Local | Créer            | Table manquante |
| `fournisseurs`     | `referent_id` | Neon    | uuid              | Si utilisé |

### 6.3 Colonnes à renommer (harmonisation)

| Table          | Ancienne colonne | Nouvelle colonne | Côté     | Justification |
|---------------|------------------|------------------|---------|---------------|
| `receptions`  | `date`           | `created_at`     | Local + Neon | Cohérence nommage |
| `prospects`   | `date_creation`  | `created_at`     | Local    | Cohérence nommage |

### 6.4 Colonnes à harmoniser (types)

| Table       | Colonne      | Type actuel (Local) | Type cible | Notes |
|------------|-------------|---------------------|------------|-------|
| `carts`    | `created_at`, `updated_at` | INTEGER | TEXT ou garder INTEGER | Timestamp Unix vs ISO8601 |
| `cart_items` | `created_at`, `updated_at` | INTEGER | TEXT ou garder INTEGER | Timestamp Unix vs ISO8601 |

**Décision à prendre :**
- **Option A** : Garder INTEGER (timestamp Unix) et convertir en TEXT ISO8601 à la volée
- **Option B** : Migrer vers TEXT ISO8601 partout (cohérence)

**Recommandation : Option B** (migrer vers TEXT ISO8601 pour cohérence)

---

## 7. Tables manquantes à créer

### 7.1 Côté Local (SQLite)

1. **`inventory_snapshot`**
2. **`inventory_adjust`**
3. **`stock_movements`** (table incomplète, à compléter)

### 7.2 Côté Neon (PostgreSQL)

1. **`prospects`** (si module utilisé)
2. **`prospects_invitations`** (si module utilisé)

---

## 8. Script de migration (à générer)

Les prochaines étapes seront de générer des scripts SQL pour :

1. **Migration locale (SQLite)** :
   - `ALTER TABLE` pour ajouter colonnes manquantes
   - `CREATE TABLE` pour tables manquantes
   - Migration de données (renommage colonnes, conversion types)

2. **Migration Neon (PostgreSQL)** :
   - `ALTER TABLE` pour ajouter colonnes manquantes
   - `CREATE TABLE` pour tables manquantes
   - Migration de données

3. **Scripts de validation** :
   - Comparaison schémas avant/après
   - Tests de sync après migration

---

**Prochaine étape :** Veux-tu que je génère les scripts de migration SQL pour local et Neon ?
