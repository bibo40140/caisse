// src/renderer/pages/receptions.js
(() => {
  // --- Helpers sûrs pour lignes ---
  function ensureArray(maybeArray) {
    if (Array.isArray(maybeArray)) return maybeArray;
    if (maybeArray && typeof maybeArray === 'object') return Object.values(maybeArray);
    return [];
  }
  function normalizeReceptionDetails(raw) {
    // Peut être:
    //  - array de lignes
    //  - { lignes: [...], header: {...} }
    //  - { lignes: {id: {...}}, header: {...} }
    //  - autres variantes -> on renvoie toujours { header, lignes: [] }
    if (Array.isArray(raw)) return { header: null, lignes: raw };
    if (raw && typeof raw === 'object') {
      const header = raw.header || raw.meta || null;
      const lignes = ensureArray(raw.lignes || raw.lines || raw);
      return { header, lignes };
    }
    return { header: null, lignes: [] };
  }

  async function renderReception() {
    const content = document.getElementById("page-content");
    const fournisseurs = await window.electronAPI.getFournisseurs();
    let produits = await window.electronAPI.getProduits();
    let fournisseurSelectionne = null;
    let produitsFournisseur = [];
    let lignesReception = [];

    const R_LINES_KEY = 'reception_lignes';

    function loadReceptionLines() {
      try {
        const raw = localStorage.getItem(R_LINES_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    }
    function saveReceptionLines() {
      try {
        const compact = lignesReception.map(l => ({
          produit_id: l.produit?.id,
          quantite: l.quantite ?? '',
          prix: l.prix ?? '',
          stockCorrige: l.stockCorrige ?? ''
        })).filter(x => !!x.produit_id);
        localStorage.setItem(R_LINES_KEY, JSON.stringify(compact));
      } catch (e) {}
    }

    const savedCompact = loadReceptionLines();
    if (Array.isArray(savedCompact) && savedCompact.length) {
      const byId = new Map(produits.map(p => [Number(p.id), p]));
      lignesReception = savedCompact
        .map(s => {
          const prod = byId.get(Number(s.produit_id));
          if (!prod) return null;
          return {
            produit: prod,
            quantite: s.quantite ?? '',
            prix: (s.prix === '' || s.prix == null) ? prod.prix : s.prix,
            stockCorrige: s.stockCorrige ?? ''
          };
        })
        .filter(Boolean);
    }

    const F_KEY  = 'reception_fournisseur_id';
    const labelF = (f) => `${f.nom} — #${f.id}`;

    async function ouvrirPopupNouveauProduit(fournisseurId) {
      if (!fournisseurId) { await showAlertModal("Sélectionnez d’abord un fournisseur."); return; }
      const unites = await window.electronAPI.getUnites();

      const form = document.createElement('form');
      form.innerHTML = `
        <label>Nom :
          <input name="nom" required style="width:100%" placeholder="Ex : Pommes Reinette">
        </label><br><br>
        <label>Prix (€) :
          <input type="number" name="prix" step="0.01" min="0" inputmode="decimal" required placeholder="Ex : 2.50">
        </label><br><br>
        <label>Stock initial :
          <input type="number" name="stock" step="0.01" min="0" inputmode="decimal" required placeholder="Ex : 0">
        </label><br><br>
        <label>Unité :
          <select name="unite" required>
            <option value="">-- Choisir --</option>
            ${unites.map(u => `<option value="${u.nom}">${u.nom}</option>`).join('')}
          </select>
        </label><br><br>
        <label>Code-barres :
          <input name="code_barre" placeholder="Optionnel">
        </label>
      `;
      const ok = await showFormModal('➕ Nouveau produit', form);
      if (!ok) return;

      const nom   = (form.nom.value || '').trim();
      const prix  = parseFloat(String(form.prix.value || '').replace(',', '.'));
      const stock = parseFloat(String(form.stock.value || '').replace(',', '.'));
      const unite = (form.unite.value || '').trim();
      if (!nom || !unite || !Number.isFinite(prix) || !Number.isFinite(stock) || prix < 0 || stock < 0) {
        await showAlertModal("Merci de renseigner le nom, le prix, le stock et l’unité (valeurs positives).");
        return;
      }

      const nouveau = {
        nom, prix, stock, unite,
        code_barre: (form.code_barre.value || '').trim(),
        fournisseur_id: fournisseurId
      };

      const existant = await window.electronAPI
        .rechercherProduitParNomEtFournisseur(nouveau.nom, fournisseurId);

      if (existant) {
        const choix = await showChoixModal(
          `⚠️ Un produit nommé <strong>${existant.nom}</strong> existe déjà chez ce fournisseur.<br><br>Que souhaitez-vous faire ?`,
          ['Remplacer', 'Ajouter quand même', 'Annuler']
        );
        if (choix === 'Annuler') return;
        if (choix === 'Remplacer') {
          await window.electronAPI.supprimerEtRemplacerProduit(nouveau, existant.id);
        } else {
          await window.electronAPI.ajouterProduit(nouveau);
        }
      } else {
        await window.electronAPI.ajouterProduit(nouveau);
      }

      await showAlertModal('✅ Produit créé !');
      produits = await window.electronAPI.getProduits();
      produitsFournisseur = produits.filter(p => p.fournisseur_id === fournisseurId);
      afficherListeProduitsFournisseur();
    }

    const afficherLignes = async () => {
      const zone = document.getElementById("zone-lignes-reception");
      if (!zone) return;

      if (lignesReception.length === 0) {
        zone.innerHTML = '<p style="color:#666;">Aucun produit ajouté.</p>';
        return;
      }

      const mods = await window.electronAPI.getModules();
      const stocksOn = !!(mods && mods.stocks);

      zone.innerHTML = `
        <div style="max-width:980px">
          <div style="margin-bottom:10px">
            <label>Référence BL :
              <input id="referenceInput" class="ui-field" placeholder="Ex : BL-2025-00123">
            </label>
          </div>
          <table class="reception-table">
            <thead>
              <tr>
                <th>Produit</th>
                ${stocksOn ? '<th>Stock actuel</th><th>Corriger le stock</th><th>Qté reçue</th>' : ''}
                <th>Prix actuel</th>
                <th>Nouveau prix</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${lignesReception.map((l, i) => `
                <tr>
                  <td>${l.produit.nom}</td>
                  ${stocksOn ? `
                    <td>${l.produit.stock}</td>
                    <td><input class="input-stock-corrige" type="number" step="0.01" data-index="${i}" data-type="stockCorrige" value="${l.stockCorrige}"></td>
                    <td><input class="input-quantite" type="number" step="0.01" data-index="${i}" data-type="quantite" value="${l.quantite}"></td>
                  ` : ''}
                  <td>${Number(l.produit.prix || 0).toFixed(2)} €</td>
                  <td><input type="number" step="0.01" data-index="${i}" data-type="prix" value="${l.prix}"></td>
                  <td><button data-index="${i}" class="btn-supprimer-ligne">🗑️</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      if (!stocksOn) {
        zone.querySelectorAll('.input-quantite, .input-stock-corrige')
          .forEach(el => { el.disabled = true; if (!el.placeholder) el.placeholder = 'Stocks OFF'; });
      }

      zone.querySelectorAll("input[data-type]").forEach(input => {
        input.addEventListener("input", e => {
          const i = parseInt(e.target.dataset.index, 10);
          const type = e.target.dataset.type;
          lignesReception[i][type] = e.target.value;
          saveReceptionLines();
        });
      });

      zone.querySelectorAll(".btn-supprimer-ligne").forEach(btn => {
        btn.addEventListener("click", () => {
          const i = parseInt(btn.dataset.index, 10);
          lignesReception.splice(i, 1);
          saveReceptionLines();
          afficherLignes();
        });
      });
    };

    const _normR = (s) =>
      (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const _singR = (s) => s.replace(/s\b/g, '');
    const _tokensR = (s) =>
      _normR(s).split(/\s+/).map(_singR).filter(Boolean);

    const afficherListeProduitsFournisseur = (forceRebuild = false) => {
      const zone = document.getElementById("liste-produits-fournisseur");
      if (!zone || !fournisseurSelectionne) return;

      if (!zone.dataset.wired || forceRebuild) {
        zone.innerHTML = `
          <h3>📦 Produits du fournisseur</h3>
          <div style="margin-bottom:10px">
            <input id="recherche-produit" class="ui-field" placeholder="Filtrer par nom ou code-barres">
          </div>
          <div id="cards-produits-fournisseur" class="produits-cards"></div>
        `;
        zone.dataset.wired = '1';
        const input = document.getElementById("recherche-produit");
        input.addEventListener("input", (e) => { renderCardsForSupplier(e.target.value); });
      }
      const inputVal = document.getElementById("recherche-produit")?.value || '';
      renderCardsForSupplier(inputVal);
    };

    const renderCardsForSupplier = async (query = '') => {
      const cont = document.getElementById("cards-produits-fournisseur");
      if (!cont) return;

      const toks = _tokensR(query);
      let list = produitsFournisseur;

      if (toks.length > 0) {
        list = produitsFournisseur.filter(p => {
          const nom = _singR(_normR(p.nom || ''));
          const cb  = (p.code_barre || '').toString();
          return toks.every(t => nom.includes(t) || cb.includes(t));
        });
      }

      if (list.length === 0) {
        cont.innerHTML = `<p style="color:#999">Aucun produit ne correspond à votre recherche.</p>`;
        return;
      }

      const mods = await window.electronAPI.getModules();
      const stocksOn = !!(mods && mods.stocks);

      cont.innerHTML = list.map(p => `
        <div class="produit-card" onclick="ajouterProduitReception(${p.id})">
          <strong>${p.nom}</strong>
          ${stocksOn ? `<div>Stock : ${p.stock}</div>` : ``}
          <div>${Number(p.prix || 0).toFixed(2)} €</div>
        </div>
      `).join('');
    };

    window.ajouterProduitReception = (id) => {
      const produit = produitsFournisseur.find(p => p.id === id);
      if (produit && !lignesReception.some(l => l.produit.id === id)) {
        lignesReception.push({ produit, quantite: '', prix: produit.prix, stockCorrige: '' });
        saveReceptionLines();
        afficherLignes();
        const inputRecherche = document.getElementById("recherche-produit");
        if (inputRecherche) inputRecherche.value = "";
        afficherListeProduitsFournisseur();
      }
    };

    const afficherInterface = async () => {
      content.innerHTML = `
        <div class="reception-header">
          <h2>📦 Réception de produits</h2>

          <label for="fournisseur-input" style="font-weight:600;">🚚 Fournisseur</label>
          <div class="ui-wrap">
            <input id="fournisseur-input"
                   class="ui-field"
                   list="fournisseurs-list"
                   placeholder="Rechercher un fournisseur…"
                   autocomplete="off">
            <span class="ui-chevron">▾</span>
          </div>

          <datalist id="fournisseurs-list">
            ${fournisseurs.map(f => `<option value="${labelF(f)}">`).join('')}
          </datalist>

          <input type="hidden" id="fournisseur-id">

          <div style="margin-top:10px;">
            <button id="btn-nouveau-produit" class="btn-secondary">➕ Nouveau produit</button>
          </div>
        </div>

        <div id="zone-lignes-reception" style="margin-top: 30px;"></div>
        <div id="liste-produits-fournisseur" style="margin-top: 30px;"></div>
        <div style="margin-top: 20px;">
          <button id="valider-reception" class="btn-valider">✅ Valider la réception</button>
        </div>
      `;

      enhanceCategorySelectsInReceptions();
      wireDatalistChevron('fournisseur-input');

      const inputF  = document.getElementById('fournisseur-input');
      const hiddenF = document.getElementById('fournisseur-id');
      const btnNew  = document.getElementById('btn-nouveau-produit');
      if (!inputF || !hiddenF) return;

      const fournisseurIndex = new Map(fournisseurs.map(f => [labelF(f), f]));

      inputF.value = ''; hiddenF.value = '';
      localStorage.removeItem(F_KEY);
      fournisseurSelectionne = null;
      produitsFournisseur = [];

      if (btnNew) {
        btnNew.onclick = async () => {
          const fid = parseInt(hiddenF.value || '0', 10);
          if (!fid) { await showAlertModal("Sélectionnez d’abord un fournisseur."); inputF?.focus(); return; }
          await ouvrirPopupNouveauProduit(fid);
        };
      }

      await afficherLignes();
      const zonePF = document.getElementById('liste-produits-fournisseur');
      if (zonePF) zonePF.innerHTML = '';

      inputF.addEventListener('change', () => {
        const saisie = (inputF.value || '').trim();

        let f = fournisseurIndex.get(saisie);
        if (!f) {
          const matches = fournisseurs.filter(x => x.nom.toLowerCase() === saisie.toLowerCase());
          if (matches.length === 1) f = matches[0];
        }

        if (!f) {
          hiddenF.value = '';
          localStorage.removeItem(F_KEY);
          fournisseurSelectionne = null;
          produitsFournisseur = [];
          if (btnNew) {
            btnNew.disabled = true;
            btnNew.title = 'Sélectionnez d’abord un fournisseur';
            btnNew.onclick = null;
          }
          afficherListeProduitsFournisseur();
          return;
        }

        hiddenF.value = String(f.id);
        localStorage.setItem(F_KEY, String(f.id));
        fournisseurSelectionne = f.id;
        produitsFournisseur = produits.filter(p => p.fournisseur_id === f.id);

        if (btnNew) {
          btnNew.disabled = false;
          btnNew.title = '';
          btnNew.onclick = async () => {
            const fid = parseInt(hiddenF.value || '0', 10);
            if (!fid) return;
            await ouvrirPopupNouveauProduit(fid);
          };
        }

        afficherListeProduitsFournisseur(true);
      });

      const btnValider = document.getElementById("valider-reception");
      if (btnValider) {
        btnValider.addEventListener("click", async () => {
          if (lignesReception.length === 0) { alert("Aucun produit ajouté."); return; }

          const referenceGlobale = (document.getElementById('referenceInput')?.value || '').trim() || null;

          // Regroupement par fournisseur
          const groupesParFournisseur = {};
          for (const l of lignesReception) {
            const fid = l.produit?.fournisseur_id;
            if (!fid) { await showAlertModal(`Un des produits n'a pas de fournisseur associé.`); return; }
            if (!groupesParFournisseur[fid]) groupesParFournisseur[fid] = [];
            groupesParFournisseur[fid].push(l);
          }

          let nbBL = 0;
          for (const [fid, lines] of Object.entries(groupesParFournisseur)) {
            const modules = await window.electronAPI.getModules();
            const stocksOn = !!(modules && modules.stocks);

            const reception = {
              fournisseur_id: parseInt(fid, 10),
              fournisseurId: parseInt(fid, 10),
              reference: referenceGlobale,
              lignes: lines.map(l => ({
                produit_id: l.produit.id,
                quantite: stocksOn ? (Number(l.quantite) || 0) : 0,
                prix_unitaire: Number(l.prix) || 0,
                fournisseur_id: parseInt(fid, 10),
                fournisseurId: parseInt(fid, 10),
                reference: referenceGlobale,
                stock_corrige: stocksOn
                  ? ((l.stockCorrige !== '' && l.stockCorrige != null) ? Number(l.stockCorrige) : null)
                  : null
              }))
            };

            try {
              const res = await window.electronAPI.enregistrerReception(reception);

              // ✅ reconnaître toutes les formes de succès renvoyées par le main
              const ok =
                res === true ||
                (res && (res.success === true || res.ok === true)) ||
                Number.isFinite(res) ||
                (res && Number.isFinite(res.receptionId));

              if (!ok) {
                const msg = (res && (res.error || res.message)) || 'Réponse inattendue du main-process';
                await showAlertModal(`❌ Erreur en créant le bon pour le fournisseur #${fid} : ${msg}`);
                return;
              }
              nbBL++;
            } catch (err) {
              const msg = err?.message || err?.stack || String(err);
              await showAlertModal(`❌ Erreur en créant le bon pour le fournisseur #${fid} : ${msg}`);
              return;
            }
          }

          await showAlertModal(`✅ ${nbBL} bon(s) de livraison créé(s) (un par fournisseur).`);
          localStorage.removeItem(R_LINES_KEY);
          lignesReception = [];
          renderReception();
        });
      }
    };

    await afficherInterface();
  }

  async function renderReceptions() {
    const content = document.getElementById("page-content");

    async function voirDetailsReception_local(receptionId) {
      const content = document.getElementById("page-content");
      const [toutes, rawDetails] = await Promise.all([
        window.electronAPI.getReceptions(),
        window.electronAPI.getReceptionDetails(receptionId)
      ]);
      const { lignes } = normalizeReceptionDetails(rawDetails);
      const L = ensureArray(lignes);

      const totalReception = L.reduce((s, l) => {
        const q  = Number(l.quantite || 0);
        const pu = Number(l.prix_unitaire || 0);
        return s + (Number.isFinite(q) && Number.isFinite(pu) ? q * pu : 0);
      }, 0);

      const header = toutes.find(r => Number(r.id) === Number(receptionId));
      if (!header) { content.innerHTML = "<p>Réception introuvable.</p>"; return; }

      const fmtPrix = (v) =>
        (v === null || v === undefined || isNaN(Number(v))) ? "—" : `${Number(v).toFixed(2)} €`;

      content.innerHTML = `
        <button class="btn-retour" onclick="renderReceptions()">← Retour</button>
        <h2>📄 Détail de la réception</h2>

        <div class="detail-section">
          <p><strong>Date :</strong> ${new Date(header.date).toLocaleString()}</p>
          <p><strong>Référence :</strong> ${header.reference || '—'}</p>
          <p><strong>Fournisseur :</strong> ${header.fournisseur || '—'}</p>
          <p><strong>Total réception :</strong> ${fmtPrix(totalReception)}</p>
        </div>

        <h3 style="margin-top:30px;">📦 Produits reçus</h3>

        <table class="reception-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Unité</th>
              <th>Qté reçue</th>
              <th>Prix unitaire</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${L.map(l => `
              <tr>
                <td>${l.produit || '—'}</td>
                <td>${l.unite || '—'}</td>
                <td>${(l.quantite === null || l.quantite === undefined) ? '—' : l.quantite}</td>
                <td>${fmtPrix(l.prix_unitaire)}</td>
                <td>${fmtPrix((Number(l.quantite||0)) * (Number(l.prix_unitaire||0)))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    const [receptions, fournisseurs] = await Promise.all([
      window.electronAPI.getReceptions(),
      window.electronAPI.getFournisseurs()
    ]);

    const fmtPrix = (v) =>
      (v === null || v === undefined || isNaN(Number(v))) ? '—' : `${Number(v).toFixed(2)} €`;

    const totalsById = new Map();
    await Promise.all(receptions.map(async (r) => {
      const raw = await window.electronAPI.getReceptionDetails(r.id);
      const { lignes } = normalizeReceptionDetails(raw);
      const L = ensureArray(lignes);
      const tot = L.reduce((s, l) => {
        const q  = Number(l.quantite || 0);
        const pu = Number(l.prix_unitaire || 0);
        if (!Number.isFinite(q) || !Number.isFinite(pu)) return s;
        return s + q * pu;
      }, 0);
      totalsById.set(r.id, tot);
    }));

    let filtreMois = '';
    let filtreAnnee = '';
    let filtreFournisseur = '';
    const anneesDisponibles = Array.from(new Set(receptions.map(r => new Date(r.date).getFullYear()))).sort();

    const afficher = () => {
      const receptionsFiltrees = receptions.filter(r => {
        const d = new Date(r.date);
        const dateOK =
          (!filtreMois || d.getMonth() + 1 === parseInt(filtreMois)) &&
          (!filtreAnnee || d.getFullYear() === parseInt(filtreAnnee));
        const fournisseurOK = !filtreFournisseur || r.fournisseur === filtreFournisseur;
        return dateOK && fournisseurOK;
      });

      content.innerHTML = `
        <h2>📦 Historique des réceptions</h2>
        <div style="display:flex; gap:20px; margin: 20px 0;">
          <div>
            <label>Mois :</label><br>
            <select id="filtre-mois">
              <option value="">-- Tous --</option>
              ${[...Array(12)].map((_, i) => `
                <option value="${i + 1}" ${filtreMois == i + 1 ? 'selected' : ''}>${(i + 1).toString().padStart(2, '0')}</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label>Année :</label><br>
            <select id="filtre-annee">
              <option value="">-- Toutes --</option>
              ${anneesDisponibles.map(annee => `
                <option value="${annee}" ${filtreAnnee == annee ? 'selected' : ''}>${annee}</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label>Fournisseur :</label><br>
            <select id="filtre-fournisseur">
              <option value="">-- Tous --</option>
              ${fournisseurs.map(f => `
                <option value="${f.nom}" ${filtreFournisseur === f.nom ? 'selected' : ''}>${f.nom}</option>
              `).join('')}
            </select>
          </div>
        </div>
        ${receptionsFiltrees.length === 0 ? '<p>Aucune réception trouvée.</p>' : `
          <table class="reception-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Référence</th>
                <th>Fournisseur</th>
                <th>Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${receptionsFiltrees.map(r => `
                <tr>
                  <td>${new Date(r.date).toLocaleString()}</td>
                  <td>${r.reference || '—'}</td>
                  <td>${r.fournisseur || '—'}</td>
                  <td>${fmtPrix(totalsById.get(r.id))}</td>
                  <td><button class="btn-voir-reception" data-id="${r.id}">📄 Voir</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      `;

      document.getElementById("filtre-mois").addEventListener("change", e => { filtreMois = e.target.value; afficher(); });
      document.getElementById("filtre-annee").addEventListener("change", e => { filtreAnnee = e.target.value; afficher(); });
      document.getElementById("filtre-fournisseur").addEventListener("change", e => { filtreFournisseur = e.target.value; afficher(); });

      document.querySelectorAll(".btn-voir-reception").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = parseInt(btn.dataset.id);
          voirDetailsReception_local(id);
        });
      });
    };
    afficher();
  }

  function enhanceCategorySelectsInReceptions() {
    document.querySelectorAll('select.select-categorie').forEach(sel => {
      sel.classList.add('searchable-select');
      sel.dataset.placeholder = 'Rechercher une catégorie…';
      window.SearchableSelect?.wire(sel);
    });
  }

  window.PageReceptions = { renderReception, renderReceptions };
})();
