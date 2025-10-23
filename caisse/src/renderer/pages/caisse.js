// src/renderer/pages/caisse.js
(function () {
  // petite utilitaire pour temporiser le loader
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  let currentCartId = null; // ticket actuellement chargé
  try { currentCartId = localStorage.getItem('currentCartId') || null; } catch { }

  // ───────────────────────────────────────────────────────────
  // Helpers UI génériques
  // ───────────────────────────────────────────────────────────

  // Ouvre/ferme la "datalist" d’un input via un chevron à côté.
  function wireDatalistChevron(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Essaie de trouver le chevron voisin dans .ui-wrap
    const wrap = input.closest('.ui-wrap');
    const chevron = wrap?.querySelector('.ui-chevron');
    if (!chevron) return;

    chevron.style.cursor = 'pointer';
    chevron.addEventListener('click', () => {
      // Petite astuce : on simule un focus + une frappe pour forcer l’ouverture
      input.focus();
      const val = input.value;
      input.value = '';
      setTimeout(() => {
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    });
  }

  async function showTextPromptModal(message, placeholder = '') {
    return new Promise((resolve) => {
      // Fabrique une mini-modale réutilisable
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <h3>${message}</h3>
        <input type="text" id="__textprompt_input" placeholder="${placeholder}" />
        <div class="modal-actions">
          <button id="__textprompt_ok">Valider</button>
          <button id="__textprompt_cancel">Annuler</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const input = modal.querySelector('#__textprompt_input');
      const okBtn = modal.querySelector('#__textprompt_ok');
      const cancelBtn = modal.querySelector('#__textprompt_cancel');

      const cleanup = (val) => {
        try { document.body.removeChild(overlay); } catch {}
        resolve(val);
      };

      okBtn.addEventListener('click', () => cleanup(input.value));
      cancelBtn.addEventListener('click', () => cleanup(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') okBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      });
      setTimeout(() => input.focus(), 0);
    });
  }

  async function showTextModal(label = 'Nom', def = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.35);
        display:flex; align-items:center; justify-content:center; z-index:99999;
      `;
      const modal = document.createElement('div');
      modal.style.cssText = `
        background:#fff; border:1px solid #e6e6e6; border-radius:12px; width:min(420px, 92vw);
        box-shadow:0 10px 30px rgba(0,0,0,.2); padding:14px; display:flex; flex-direction:column; gap:10px;
      `;
      modal.innerHTML = `
        <label style="font-weight:600;">${label}</label>
        <input id="txt-name" type="text" class="ui-field" placeholder="(optionnel)" value="${(def || '').replace(/"/g, '&quot;')}">
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button id="txt-cancel" type="button">Annuler</button>
          <button id="txt-ok" type="button">OK</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const input = modal.querySelector('#txt-name');
      const close = (val) => { try { document.body.removeChild(overlay); } catch { }; resolve(val); };
      modal.querySelector('#txt-cancel').addEventListener('click', () => close(null));
      modal.querySelector('#txt-ok').addEventListener('click', () => close(String(input.value || '').trim() || null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') modal.querySelector('#txt-ok').click();
        if (e.key === 'Escape') close(null);
      });
      setTimeout(() => input.focus(), 20);
    });
  }

  // ───────────────────────────────────────────────────────────
  // 👉 DÉFINIS ici la VRAIE fonction renderCaisse
  // ───────────────────────────────────────────────────────────
  async function renderCaisse() {
    // 🔧 Lire la config modules d'abord
    const modules = await (window.getMods?.() || window.electronAPI.getModules());
    const adherentsOn    = !!modules.adherents;
    const cotisationsOn  = !!(modules.adherents && modules.cotisations);
    const extOn          = !!modules.ventes_exterieur;
    const prospectsOn    = !!modules.prospects;
    const modesOn        = !!modules.modes_paiement;

    // saleMode : on respecte le dernier choix tant que l'utilisateur n'a pas vidé/validé.
    // S'il n'existe pas encore, défaut = 'adherent' si dispo, sinon 'exterieur'.
    let saleMode = localStorage.getItem('saleMode') || (adherentsOn ? 'adherent' : (extOn ? 'exterieur' : 'adherent'));

    // 🔧 Lire la marge ventes ext. (défaut 30%)
    let extMargin = 30;
    try {
      if (window.electronAPI.getVentesMargin) {
        const r = await window.electronAPI.getVentesMargin();
        const v = Number(r?.percent);
        if (Number.isFinite(v) && v >= 0) extMargin = v;
      } else {
        const cfg = await window.electronAPI.getConfig();
        const v = Number(cfg?.ventes_ext_margin_percent);
        if (Number.isFinite(v) && v >= 0) extMargin = v;
      }
    } catch { }
    const extFactor = 1 + (extMargin / 100);
    // Libellé dynamique pour le bouton radio "Extérieur"
    const fmtPct = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.00$/, ''));
    const extPctLabel = `(+${fmtPct(extMargin)}%)`;

    // si Extérieur OFF mais saleMode='exterieur' → on force 'adherent'
    if (!extOn && saleMode === 'exterieur') {
      saleMode = 'adherent';
      localStorage.setItem('saleMode', 'adherent');
    }
    // si Adhérents OFF mais Extérieur ON et saleMode='adherent' → on force 'exterieur'
    if (!adherentsOn && extOn && saleMode === 'adherent') {
      saleMode = 'exterieur';
      localStorage.setItem('saleMode', 'exterieur');
    }

    const content    = document.getElementById('page-content');
    const produits   = await window.electronAPI.getProduits();
    await window.electronAPI.getCategoriesProduits();
    const adherents  = adherentsOn ? (await window.electronAPI.getAdherents()) : [];
    const modes      = modesOn ? (await window.electronAPI.getModesPaiement()) : [];
    let modeSelectionneId = ''; // pas de présélection

    function sommeAcompte(list) {
      return list
        .filter(p => p.type === 'acompte')
        .reduce((s, p) => s + Math.abs(Number(p.prix) * Number(p.quantite || 1)), 0);
    }

    // 🔎 filtres actifs (famille / catégorie enfants)
    let familleActive = null;
    let categorieActive = null;
    let showCatsAllFamilies = false;

    let panier = [];
    window.panier = panier; // rend le panier visible globalement

    let adherentSelectionneId = localStorage.getItem('adherentId') || '';
    let selectedProspect = null;
    try { selectedProspect = JSON.parse(localStorage.getItem('selectedProspect') || 'null'); } catch { }

    try {
      const panierStocke = localStorage.getItem('panier');
      if (panierStocke) panier = JSON.parse(panierStocke);
      window.panier = panier; // met à jour la référence globale après réassignation
    } catch (e) {
      console.error('Erreur lors du chargement du panier depuis le localStorage', e);
    }

    let produitEnCours = null;

    const sauvegarderPanier = () => {
      try {
        localStorage.setItem('panier', JSON.stringify(panier));
      } catch (e) {
        console.error("Erreur lors de l'enregistrement du panier", e);
      }
    };

    // ───────────────────────────────────────────────────────────
    // Cotisation (mensuelle) : vérifie et propose d’ajouter une ligne
    // ───────────────────────────────────────────────────────────
    async function verifierCotisationAdherent(adherentId, nomComplet, panierRef, refreshUI) {
      try {
        const r = await window.electronAPI.verifierCotisation(Number(adherentId));
        if (!r?.ok) return;

        if (r.a_jour) {
          // rien à faire
          return;
        }

        // propose d’ajouter la cotisation
        const defMontant = 10; // par défaut
        const saisie = await showTextPromptModal(
          `💳 ${nomComplet} n'est pas à jour de sa cotisation mensuelle.\nMontant à ajouter (en €) :`,
          String(defMontant)
        );
        if (saisie == null) return; // annulé
        const montant = Math.abs(parseFloat(String(saisie).replace(',', '.')));
        if (!montant || Number.isNaN(montant) || montant <= 0) {
          alert('Montant invalide.');
          return;
        }

        // éviter les doublons si une cotisation traîne déjà
        const existe = panierRef.some(p => p.type === 'cotisation');
        if (!existe) {
          panierRef.push({
            id: `cotisation-${Date.now()}`,
            type: 'cotisation',
            nom: 'Cotisation (mois en cours)',
            prix: montant,
            quantite: 1
          });
          try { localStorage.setItem('panier', JSON.stringify(panierRef)); } catch {}
          if (typeof refreshUI === 'function') refreshUI();
        }
      } catch (e) {
        console.warn('[cotisation] vérification non bloquante:', e?.message || e);
      }
    }

    // ─ Helpers tickets en attente ─
    function currentSaleContext(modules, saleMode, adherentSelectionneId, selectedProspect) {
      const sale_type = (saleMode === 'exterieur') ? 'exterieur' : (selectedProspect ? 'prospect' : 'adherent');

      const hiddenAdh = document.getElementById('adherent-select');
      const adherentId = (sale_type === 'adherent')
        ? (Number(hiddenAdh?.value) || null)
        : null;

      const client_email = (sale_type === 'exterieur')
        ? ((document.getElementById('ext-email')?.value || '').trim() || null)
        : (selectedProspect?.email || null);

      const modeSelect = document.getElementById('mode-paiement-select');
      const mode_paiement_id = (modules.modes_paiement && modeSelect?.value)
        ? Number(modeSelect.value)
        : null;

      return {
        sale_type,
        adherent_id: adherentId,
        prospect_id: selectedProspect?.id || null,
        client_email,
        mode_paiement_id,
      };
    }

    async function holdCurrentCart(modules, saleMode, adherentSelectionneId, selectedProspect, panier) {
      const ctx = currentSaleContext(modules, saleMode, adherentSelectionneId, selectedProspect);

      // 🏷️ Nom du ticket: si adhérent présent → "Nom Prénom", sinon on demande
      let name = null;
      if (ctx.sale_type === 'adherent' && ctx.adherent_id) {
        const a = (Array.isArray(adherents) ? adherents : []).find(x => String(x.id) === String(ctx.adherent_id));
        if (a) name = `${(a.nom || '').trim()} ${(a.prenom || '').trim()}`.trim() || null;
      }
      if (!name) {
        name = await showTextModal('Nom du ticket (optionnel)', '');
      }

      const id = 'cart-' + Date.now();
      const items = (panier || []).map(p => {
        const prodIdNum = Number(p.id);
        return {
          produit_id: Number.isFinite(prodIdNum) ? prodIdNum : null,
          nom: p.nom,
          fournisseur_nom: p.fournisseur_nom || null,
          unite: p.unite || null,
          prix: Number(p.prix || 0),
          quantite: Number(p.quantite || 0),
          remise_percent: Number(p.remise || 0),
          type: p.type || 'produit'
        };
      });

      const res = await window.carts.save({
        id,
        name,
        ...ctx,
        meta: {},
        items,
        status: 'open'
      });
      if (res?.ok) {
        currentCartId = res.id;
        try { localStorage.setItem('currentCartId', res.id); } catch { }
        alert('Ticket mis en attente 👍');
        viderPanier({ skipConfirm: true });
      } else {
        alert('Échec mise en attente');
      }
    }

    async function showLoadCartDialog() {
      const rows = await window.carts.list({ status: 'open', limit: 100 });
      if (!rows || rows.length === 0) {
        alert('Aucun ticket en attente.');
        return;
      }

      // Alerte si on va écraser un panier déjà rempli
      if (Array.isArray(window.panier) && window.panier.length > 0) {
        const ok = confirm('⚠️ La récupération va écraser le panier en cours. Continuer ?');
        if (!ok) return;
      }

      // --- UI de la popup ---
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.35);
        display:flex; align-items:center; justify-content:center; z-index:99999;
      `;
      const modal = document.createElement('div');
      modal.style.cssText = `
        background:#fff; border:1px solid #e6e6e6; border-radius:12px; width:min(720px, 92vw);
        box-shadow:0 10px 30px rgba(0,0,0,.2); padding:14px;
        max-height:80vh; display:flex; flex-direction:column; gap:10px;
      `;
      modal.innerHTML = `
        <h3 style="margin:0 0 4px 0;">Récupérer un ticket</h3>
        <div class="list" style="overflow:auto; border:1px solid #eee; border-radius:10px;">
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="background:#fafafa;">
                <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Nom</th>
                <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Dernière maj</th>
                <th style="padding:8px; border-bottom:1px solid #eee; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button id="dlg-cancel" type="button">Fermer</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const tbody = modal.querySelector('tbody');
      const fmtDateTime = (ms) => { try { return new Date(ms).toLocaleString(); } catch { return ''; } };

      const addRow = (r) => {
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.innerHTML = `
          <td style="padding:8px; border-bottom:1px solid #f2f2f2;">
            ${r.name || '(sans nom)'}<br>
            <small style="color:#666">${r.id}</small>
          </td>
          <td style="padding:8px; border-bottom:1px solid #f2f2f2;">${fmtDateTime(r.updated_at)}</td>
          <td style="padding:8px; border-bottom:1px solid #f2f2f2; text-align:right;">
            <button class="btn-open" data-id="${r.id}" type="button">Ouvrir</button>
            <button class="btn-del"  data-id="${r.id}" type="button" style="margin-left:6px;">🗑️ Supprimer</button>
          </td>
        `;
        tbody.appendChild(tr);
      };

      rows.forEach(addRow);

      const close = () => { try { document.body.removeChild(overlay); } catch { } };
      modal.querySelector('#dlg-cancel')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      // Délégation de clics
      tbody.addEventListener('click', async (e) => {
        const openBtn = e.target.closest('.btn-open');
        const delBtn  = e.target.closest('.btn-del');

        // — Ouvrir un ticket —
        if (openBtn) {
          const id = openBtn.dataset.id;
          try {
            const data = await window.carts.load(id);
            if (!data?.ok) { alert('Chargement impossible.'); return; }
            const chosen = data.cart;

            // 1) Convertir les lignes stockées -> format panier (uniquement vrais produits si id numérique)
            const loaded = (chosen.items || []).map(it => {
              let prodIdNum = Number(it.produit_id);

              if (!Number.isFinite(prodIdNum) || prodIdNum <= 0) {
                try {
                  const cat = Array.isArray(window.__catalogProduits)
                    ? window.__catalogProduits
                    : (Array.isArray(produits) ? produits : []);

                  let found = cat.find(p =>
                    (p.nom || '').trim().toLowerCase() === (it.nom || '').trim().toLowerCase() &&
                    (p.fournisseur_nom || '').trim().toLowerCase() === (it.fournisseur_nom || '').trim().toLowerCase()
                  );
                  if (!found) {
                    found = cat.find(p =>
                      (p.nom || '').trim().toLowerCase() === (it.nom || '').trim().toLowerCase()
                    );
                  }
                  if (found && Number.isFinite(Number(found.id))) {
                    prodIdNum = Number(found.id);
                  }
                } catch { }
              }

              const isProd = Number.isFinite(prodIdNum) && prodIdNum > 0;

              return {
                id: isProd ? prodIdNum : `virtual-${it.id}`,
                type: isProd ? 'produit' : (it.type || 'autre'),
                nom: it.nom,
                fournisseur_nom: it.fournisseur_nom || null,
                unite: it.unite || null,
                prix: Number(it.prix || 0),
                quantite: Number(it.quantite || 0),
                remise: Number(it.remise_percent || 0)
              };
            });

            // 2) Conserver la même référence de tableau
            panier.splice(0, panier.length, ...loaded);
            window.panier = panier;

            // 3) Persister + rafraîchir
            try { localStorage.setItem('panier', JSON.stringify(panier)); } catch { }
            try { afficherPanier(); } catch { }
            try { afficherProduits(); } catch { }

            // 4) Restaurer mode
            const mode = (chosen.sale_type === 'exterieur') ? 'exterieur' : 'adherent';
            localStorage.setItem('saleMode', mode);

            // 5) Restaure adhérent / prospect / email ext
            if (chosen.sale_type === 'adherent' && chosen.adherent_id) {
              localStorage.setItem('adherentId', String(chosen.adherent_id));
              localStorage.removeItem('selectedProspect');
            } else if (chosen.sale_type === 'prospect') {
              localStorage.setItem('selectedProspect', JSON.stringify({
                id: chosen.prospect_id || null,
                email: chosen.client_email || null
              }));
              localStorage.removeItem('adherentId');
            } else {
              const extEmailInput = document.getElementById('ext-email');
              if (extEmailInput) extEmailInput.value = chosen.client_email || '';
              localStorage.removeItem('adherentId');
              localStorage.removeItem('selectedProspect');
            }

            // 6) Mode de paiement
            const selMP = document.getElementById('mode-paiement-select');
            if (selMP) {
              selMP.value = chosen.mode_paiement_id ? String(chosen.mode_paiement_id) : '';
              selMP.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 7) Radio UI + champ adhérent visible
            document.querySelector(`input[name="vente-mode"][value="${mode}"]`)?.click();
            if (mode === 'adherent' && chosen.adherent_id) {
              try {
                const labelAdh = (z) => {
                  const email = (z.email1 || z.email2 || '').trim();
                  return `${z.nom} ${z.prenom}${email ? ' — ' + email : ''} (#${z.id})`;
                };
                const adherentsAll = await window.electronAPI.getAdherents?.();
                const a = (Array.isArray(adherentsAll) ? adherentsAll : [])
                  .find(x => String(x.id) === String(chosen.adherent_id));
                const hiddenAdh = document.getElementById('adherent-select');
                const inputAdh  = document.getElementById('adherent-input');
                if (a && hiddenAdh && inputAdh) {
                  hiddenAdh.value = String(a.id);
                  hiddenAdh.dataset.email = (a.email1 || a.email2 || '').trim();
                  inputAdh.value = labelAdh(a);
                }
              } catch { }
            }

            // 8) Marquer le ticket courant
            currentCartId = id;
            try { localStorage.setItem('currentCartId', id); } catch { }

            // DEBUG light
            console.group('[DEBUG] Après récupération du ticket');
            console.log('Ticket ID:', id);
            console.log('panier:', panier);
            console.groupEnd();

            close();
          } catch (err) {
            console.error('[carts] load error', err);
            alert('Erreur lors du chargement du ticket.');
          }
          return;
        }

        // — Supprimer un ticket —
        if (delBtn) {
          const id = delBtn.dataset.id;
          const tr = tbody.querySelector(`tr[data-id="${id}"]`);
          const ok = confirm('Supprimer ce ticket ?');
          if (!ok) return;
          try {
            await window.carts.delete(id);
            if (tr) tr.remove();
            if (currentCartId === id) {
              currentCartId = null;
              try { localStorage.removeItem('currentCartId'); } catch { }
            }
          } catch (err) {
            console.error('[carts] delete error', err);
            alert('Suppression impossible.');
          }
        }
      }, { passive: true });
    }

    // Helpers de recherche
    const _norm = (s) =>
      (s || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const _sing   = (s) => s.replace(/s\b/g, '');
    const _tokens = (s) => _norm(s).split(/\s+/).map(_sing).filter(Boolean);

    // ✅ en mode recherche, on N'applique PAS le filtre sur le stock
    const filtrerProduits = () => {
      const input = document.getElementById('search-produit');
      const raw = (input?.value || '').trim().toLowerCase();

      const matchFamCat = (p) => {
        const famEff = p.famille_effective_nom ?? null;
        const catEff = p.categorie_effective_nom ?? null;
        const matchFam = !familleActive || famEff === familleActive;
        const matchCat = !categorieActive || catEff === categorieActive;
        return matchFam && matchCat;
      };

      if (raw.length > 0) {
        const toks = _tokens(raw);
        return produits.filter(p => {
          if (!matchFamCat(p)) return false;
          const hay = [
            _norm(p.nom || ''),
            _norm(p.fournisseur_nom || ''),
            String(p.code_barre || '')
          ].join(' ');
          return toks.every(t => hay.includes(t));
        });
      }

      // Quand il n'y a PAS de recherche : on filtre aussi par stock si module stocks actif
      return produits.filter(p => {
        if (!matchFamCat(p)) return false;
        const matchStock = modules.stocks ? Number(p.stock) > 0 : true;
        return matchStock;
      });
    };

    const ajouterAuPanier = (produit, quantite = 1) => {
      const existant = panier.find(p => p.id === produit.id);
      if (existant) {
        existant.quantite += quantite;
      } else {
        panier.push({ ...produit, quantite });
      }
      afficherPanier();
      sauvegarderPanier();

      setTimeout(() => {
        const container = document.getElementById('panier-liste');
        const index = panier.findIndex(p => p.id === produit.id);
        const ligne = container?.querySelector(`tr[data-index="${index}"]`);
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        if (ligne) {
          ligne.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          ligne.classList.add('ligne-ajoutee');
          setTimeout(() => ligne.classList.remove('ligne-ajoutee'), 400);
        }
      }, 50);

      const search = document.getElementById('search-produit');
      if (search) {
        search.value = '';
        search.focus();
        afficherProduits();
      }
    };

    const ouvrirPopupQuantite = (produit) => {
      produitEnCours = produit;
      const nomMaj = produit.nom.toUpperCase();
      const fournisseur = produit.fournisseur_nom || '—';
      const nomElem = document.getElementById('popup-produit-nom');
      nomElem.innerHTML = `
        <div style="font-size: 1.2em; font-weight: bold;">${nomMaj}</div>
        <div style="font-size: 0.8em; color: #666;"> ${fournisseur}</div>
      `;
      document.getElementById('quantite-input').value = '';
      document.getElementById('popup-quantite').style.display = 'flex';
      document.getElementById('quantite-input').focus();
    };
    const fermerPopup = () => {
      document.getElementById('popup-quantite').style.display = 'none';
      produitEnCours = null;
    };

    // Expose pour clic carte produit **avant** le premier rendu
    window.ajouterAuPanierDepuisUI = (id) => {
      const produit = produits.find(p => p.id === id);
      if (!produit) return;
      const carte = document.querySelector(`.produit-card[onclick*="${id}"]`);
      if (carte) {
        carte.classList.add('produit-ajoute');
        setTimeout(() => carte.classList.remove('produit-ajoute'), 400);
      }
      const unite = (produit.unite || '').toLowerCase();
      if (unite === 'kg' || unite === 'litre' || unite === 'l') {
        ouvrirPopupQuantite(produit);
      } else {
        ajouterAuPanier(produit, 1);
      }
    };

    const afficherProduits = () => {
      const zoneProduits = document.getElementById('produits-zone');
      const visibles = filtrerProduits();

      zoneProduits.innerHTML = visibles.map(p => {
        const isNeg = modules.stocks && Number(p.stock) <= 0;
        const extraStyle = isNeg ? 'background: rgba(255,0,0,0.06); border: 1px solid rgba(220,50,47,0.35);' : '';
        const badge = isNeg ? `<div style="font-size:.72rem;display:inline-block;margin-bottom:6px;padding:2px 6px;border-radius:12px;background:rgba(220,50,47,.12);border:1px solid rgba(220,50,47,.35);">Stock négatif</div>` : '';
        const fullName = (p.nom || '').replace(/"/g, '&quot;');

        return `
          <div class="produit-card"
               data-tooltip="${fullName}"
               style="${extraStyle}"
               onclick="ajouterAuPanierDepuisUI(${p.id})"
               title="${isNeg ? 'Stock négatif' : ''}">
            ${badge}
            <strong>${p.nom}</strong>
            <div>${Number(p.prix).toFixed(2)} €</div>
            <div class="unite">${p.unite}</div>
            <div class="fournisseur">${p.fournisseur_nom || '—'}</div>
          </div>
        `;
      }).join('');

      if (!document.getElementById('tooltip-global')) {
        const tip = document.createElement('div');
        tip.id = 'tooltip-global';
        tip.style.position = 'absolute';
        tip.style.display = 'none';
        tip.style.zIndex = 99999;
        tip.style.background = 'black';
        tip.style.color = 'white';
        tip.style.padding = '6px 10px';
        tip.style.borderRadius = '5px';
        tip.style.fontSize = '0.85em';
        tip.style.maxWidth = '300px';
        tip.style.pointerEvents = 'none';
        tip.style.whiteSpace = 'normal';
        tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
        document.body.appendChild(tip);
      }
      const tooltip = document.getElementById('tooltip-global');

      zoneProduits.querySelectorAll('.produit-card').forEach(card => {
        const txt = card.getAttribute('data-tooltip') || '';
        card.addEventListener('mouseenter', () => {
          tooltip.innerText = txt;
          tooltip.style.display = 'block';
        });
        card.addEventListener('mousemove', (e) => {
          tooltip.style.top = `${e.pageY - 35}px`;
          tooltip.style.left = `${e.pageX + 10}px`;
        });
        card.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    };

    const calcFraisPaiement = (panierCourant) => {
      if (!modesOn) return 0;
      const select = document.getElementById('mode-paiement-select');
      if (!select || !select.value) return 0;

      const taux = parseFloat(select.selectedOptions[0].dataset.taux || 0);
      const fixe = parseFloat(select.selectedOptions[0].dataset.fixe || 0);

      const isExt = (!!modules.ventes_exterieur) && (
        document.querySelector('input[name="vente-mode"][value="exterieur"]')?.checked
        || localStorage.getItem('saleMode') === 'exterieur'
      );
      const factor = isExt ? extFactor : 1;

      const sousTotalProduits = panierCourant
        .filter(p => p.type !== 'cotisation' && p.type !== 'acompte')
        .reduce((s, p) => {
          const remise = Number(p.remise || 0);
          const puApplique = Number(p.prix) * factor * (1 - remise / 100);
          return s + puApplique * Number(p.quantite || 0);
        }, 0);

      return (sousTotalProduits * (taux / 100)) + fixe;
    };

    const afficherPanier = () => {
      const div = document.getElementById('panier-zone');

      // 👉 Calculs de mode/majoration pour CETTE vue
      const isExt = (!!modules.ventes_exterieur) && (saleMode === 'exterieur');
      const factor = isExt ? extFactor : 1;

      const totalLigne = (p) => {
        if (p.type === 'cotisation') return Number(p.prix) * Number(p.quantite || 1);
        if (p.type === 'acompte') return Number(p.prix) * Number(p.quantite || 1); // négatif
        const remise = Number(p.remise || 0);
        const puApplique = Number(p.prix) * factor * (1 - remise / 100);
        return puApplique * Number(p.quantite || 0);
      };

      const sousTotalProduits = panier
        .filter(p => p.type !== 'cotisation' && p.type !== 'acompte')
        .reduce((s, p) => {
          const remise = Number(p.remise || 0);
          const puApplique = Number(p.prix) * factor * (1 - remise / 100);
          return s + puApplique * Number(p.quantite || 0);
        }, 0);

      const totalCotisation = (isExt ? 0 : panier
        .filter(p => p.type === 'cotisation')
        .reduce((s, p) => s + Number(p.prix) * Number(p.quantite || 1), 0));

      const totalAcompte = sommeAcompte(panier);
      const frais = calcFraisPaiement(panier);
      const totalGlobal = Math.round((sousTotalProduits + totalCotisation - totalAcompte + frais) * 100) / 100;

      const afficherFraisCB = (!modesOn) ? '' : (
        frais > 0
          ? `<div class="synth-row"><span>Frais de paiement :</span><strong id="synthese-frais">${frais.toFixed(2)} €</strong></div>`
          : '<div class="synth-row" style="display:none;"><span>Frais de paiement :</span><strong id="synthese-frais">0.00 €</strong></div>'
      );

      if (!document.getElementById('tooltip-global')) {
        const tip = document.createElement('div');
        tip.id = 'tooltip-global';
        tip.style.position = 'absolute';
        tip.style.display = 'none';
        tip.style.zIndex = 99999;
        tip.style.background = 'black';
        tip.style.color = 'white';
        tip.style.padding = '6px 10px';
        tip.style.borderRadius = '5px';
        tip.style.fontSize = '0.85em';
        tip.style.maxWidth = '300px';
        tip.style.pointerEvents = 'none';
        tip.style.whiteSpace = 'normal';
        tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
        document.body.appendChild(tip);
      }

      const adhHtml = `
        <div id="adherent-container" style="${saleMode === 'adherent' && adherentsOn ? '' : 'display:none;'}">
          <label for="adherent-input" style="font-weight:600;">👤 Adhérent</label>
          <div class="ui-wrap">
            <input id="adherent-input" class="ui-field" list="adherents-list" placeholder="Nom, prénom, email…" autocomplete="off">
            <span class="ui-chevron">▾</span>
          </div>
          <datalist id="adherents-list">
            ${adherents.map(a => {
              const email = (a.email1 || a.email2 || '').trim();
              const label = `${a.nom} ${a.prenom}${email ? ' — ' + email : ''} (#${a.id})`;
              return `<option value="${label}">`;
            }).join('')}
          </datalist>
          <input type="hidden" id="adherent-select" value="" data-email="">
        </div>
      `;

      const prospectBadgeText =
        (selectedProspect && (selectedProspect.nom || selectedProspect.prenom || selectedProspect.email))
          ? `${(selectedProspect.nom || '').trim()} ${(selectedProspect.prenom || '').trim()}${selectedProspect.email ? ' · ' + selectedProspect.email : ''}`.trim()
          : '';

      const prospectMiniHtml = (!prospectsOn || !adherentsOn) ? '' : `
        <div id="prospect-mini" data-feature="prospects" style="${(saleMode === 'adherent') ? '' : 'display:none;'}; margin-top:6px;">
          <a href="#" id="pick-prospect" class="muted" style="font-size:12px;">ou sélectionner un prospect…</a>
          <span id="prospect-selected" style="${selectedProspect ? '' : 'display:none;'}; margin-left:6px;" class="pros-pill">${prospectBadgeText}</span>
          <input type="hidden" id="prospect-select" value="${selectedProspect?.id || ''}" data-email="${selectedProspect?.email || ''}">
        </div>
      `;

      // ✅ Radios visibles si "ventes_exterieur" ON (même si "adherents" OFF)
      let modeHtml = '';
      if (modules.ventes_exterieur) {
        modeHtml = `
          <div class="vente-mode" style="display:flex; gap:16px; align-items:center; margin-bottom:8px;">
            <label><input type="radio" name="vente-mode" value="adherent"
              ${saleMode === 'adherent' ? 'checked' : ''}> Adhérent</label>
            <label><input type="radio" name="vente-mode" value="exterieur"
              ${saleMode === 'exterieur' ? 'checked' : ''}> Extérieur ${extPctLabel}</label>
          </div>
        `;
      }

      const extHtml = `
        <div id="ext-container" style="${(modules.ventes_exterieur && saleMode === 'exterieur') ? '' : 'display:none;'}">
          <label for="ext-email" style="font-weight:600;">📧 E-mail (optionnel)</label>
          <input type="email" id="ext-email" placeholder="client@example.com" value="${localStorage.getItem('extEmail') || ''}">
        </div>
      `;

      // Popup Prospects (uniquement si module ON)
      const prospectPopupHtml = !prospectsOn ? '' : `
        <!-- POPUP PROSPECT -->
        <div id="popup-prospect" class="modal-overlay" style="display:none;">
          <div class="modal">
            <h3>Sélectionner un prospect</h3>

            <div id="prospect-list-zone">
              <label for="prospect-combo" style="font-weight:600;">👤 Prospect</label>
              <div class="ui-wrap" id="prospect-wrap" style="position:relative;">
                <input id="prospect-combo" class="ui-field" list="prospects-list"
                      placeholder="Nom, prénom, email…" autocomplete="off">
                <span class="ui-chevron" id="prospect-chevron" style="cursor:pointer;">▾</span>
                <div id="prospects-menu"
                      style="display:none; position:absolute; left:0; right:0; top:100%; z-index:10000;
                            max-height:260px; overflow:auto; background:#fff; border:1px solid #e6e6e6;
                            border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.12);">
                </div>
              </div>
              <datalist id="prospects-list"></datalist>
              <div class="muted" id="prospect-hint" style="font-size:12px;margin-top:6px;">Tape pour filtrer…</div>

              <div class="modal-actions" style="justify-content: space-between; margin-top:10px;">
                <button id="prospect-new"    type="button">➕ Nouveau</button>
                <button id="prospect-cancel" type="button">Fermer</button>
              </div>
            </div>

            <div id="prospect-new-form" style="display:none; margin-top:10px;">
              <h4 style="margin-top:0;">Nouveau prospect</h4>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <input id="pnew-nom"     placeholder="Nom">
                <input id="pnew-prenom"  placeholder="Prénom">
                <input id="pnew-email"   placeholder="Email">
                <input id="pnew-tel"     placeholder="Téléphone">
                <input id="pnew-ville"   placeholder="Ville">
                <input id="pnew-cp"      placeholder="Code postal">
                <input id="pnew-adresse" placeholder="Adresse" style="grid-column: span 2;">
                <textarea id="pnew-note" placeholder="Note…" style="grid-column: span 2; height:80px;"></textarea>
              </div>
              <div class="modal-actions" style="justify-content: space-between;">
                <button id="prospect-new-cancel" type="button">⬅️ Retour</button>
                <button id="prospect-create"     type="button">💾 Créer</button>
              </div>
              <div class="muted" style="font-size:12px;">
                (Au moins un <em>nom/prénom</em> ou un <em>email</em> est requis.)
              </div>
            </div>
          </div>
        </div>
      `;

      div.innerHTML = `
        <div id="panier-header">🧺 Panier</div>

        <!-- LISTE SCROLLABLE -->
        <div id="panier-liste">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                <th>Fournisseur</th>
                <th>Unité</th>
                <th>PU</th>
                <th>Remise (%)</th>
                <th>Qté</th>
                <th>Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${panier.map((p, i) => {
                const nomProduit = (p.nom || '').replace(/"/g, '&quot;');
                const remise = Number(p.remise || 0);
                const puApplique = p.type === 'cotisation'
                  ? Number(p.prix)
                  : Number(p.prix) * factor * (1 - remise / 100);
                const ligneTotal = (p.type === 'acompte')
                  ? (Number(p.prix) * Number(p.quantite || 1))
                  : (puApplique * Number(p.quantite || 0));

                if (p.type === 'acompte') {
                  return `
                    <tr data-index="${i}">
                      <td class="cell-produit" data-tooltip="${nomProduit}">${p.nom}</td>
                      <td>—</td>
                      <td>€</td>
                      <td>${Number(p.prix).toFixed(2)} €</td>
                      <td>—</td>
                      <td>—</td>
                      <td>${(Number(p.prix) * Number(p.quantite || 1)).toFixed(2)} €</td>
                      <td><button type="button" class="btn-supprimer-produit" data-index="${i}">🗑️</button></td>
                    </tr>
                  `;
                }

                return `
                  <tr data-index="${i}">
                    <td class="cell-produit" data-tooltip="${nomProduit}">${p.nom}</td>
                    <td>${p.fournisseur_nom || '—'}</td>
                    <td>${p.unite || (p.type === 'cotisation' ? '€' : '—')}</td>
                    <td>
                      ${Number(p.prix).toFixed(2)} €
                      ${remise > 0 && p.type !== 'cotisation'
                        ? `<div style="font-size:.8em;opacity:.75;">→ ${puApplique.toFixed(2)} €/u après remise</div>`
                        : ''}
                    </td>
                    <td>
                      ${p.type === 'cotisation' ? '—' : `
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          class="input-remise"
                          data-index="${i}"
                          value="${Math.max(0, Math.min(100, Math.round(remise)))}"
                          inputmode="numeric"
                          pattern="[0-9]*"
                          title="Remise en pourcentage (entier 0–100)">
                      `}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="${p.unite?.toLowerCase() === 'pièce' ? 1 : 0.01}"
                        step="${p.unite?.toLowerCase() === 'pièce' ? 1 : 0.01}"
                        class="input-quantite"
                        data-index="${i}"
                        value="${p.quantite}">
                    </td>
                    <td>${ligneTotal.toFixed(2)} €</td>
                    <td><button type="button" class="btn-supprimer-produit" data-index="${i}">🗑️</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- FOOTER COLLANT : TOTAL + ADHÉRENT/EXT + VALIDATION -->
        <div id="panier-footer">
          <div class="panier-synthese">
            <div class="synth-row"><span>Sous-total produits :</span><strong id="synthese-sous-total">${sousTotalProduits.toFixed(2)} €</strong></div>
            ${(cotisationsOn && totalCotisation > 0)
              ? `<div class="synth-row"><span>Cotisation :</span><strong id="synthese-cotisation">${totalCotisation.toFixed(2)} €</strong></div>`
              : ''}
            ${afficherFraisCB}
            ${totalAcompte > 0 ? `<div class="synth-row"><span>Acompte utilisé :</span><strong id="synthese-acompte">−${totalAcompte.toFixed(2)} €</strong></div>` : ''}
            <div class="synth-row synth-total"><span>Total :</span><strong id="synthese-total">${totalGlobal.toFixed(2)} €</strong></div>
          </div>

          <div id="validation-zone" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
            ${modeHtml}${adherentsOn ? adhHtml : ''}${prospectMiniHtml}${extHtml}

            ${modesOn ? `
              <label for="mode-paiement-select" style="font-weight:600;">💳 Mode de paiement</label>
              <div class="ui-wrap">
                <select id="mode-paiement-select" class="ui-field ui-select">
                  <option value="">-- Choisir un mode --</option>
                  ${modes.map(m => `
                    <option
                      value="${m.id}"
                      data-taux="${m.taux_percent}"
                      data-fixe="${m.frais_fixe}"
                      ${String(m.id) === String(modeSelectionneId) ? 'selected' : ''}
                    >${m.nom}</option>
                  `).join('')}
                </select>
              </div>
            ` : ''}

            <div style="display: flex; justify-content: space-between; gap: 10px; margin-top:8px;">
              <button type="button" id="btn-acompte" class="btn-acompte" style="padding: 10px;">➕ Acompte</button>
              <button class="btn-valider" onclick="validerVente()" style="padding: 10px; font-weight: bold; flex: 1;">✅ Valider la vente</button>
              <button class="btn-reset-panier" onclick="viderPanier()" style="padding: 10px; background: #eee; color: #444;">🧹 Vider</button>
            </div>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button type="button" id="btn-hold">🕓 Mettre en attente</button>
              <button type="button" id="btn-load">📂 Récupérer</button>
            </div>
          </div>
        </div>

        ${prospectPopupHtml}
      `;

      // Prospects wiring si module ON (inchangé)
      if (prospectsOn) {
        const btnPickProspect = document.getElementById('pick-prospect');
        const popProspect    = document.getElementById('popup-prospect');
        const listZone       = document.getElementById('prospect-list-zone');
        const formZone       = document.getElementById('prospect-new-form');
        const inputProspect  = document.getElementById('prospect-combo');
        const datalistProspects = document.getElementById('prospects-list');
        const hintProspect   = document.getElementById('prospect-hint');

        const btnNew     = document.getElementById('prospect-new');
        const btnNewBack = document.getElementById('prospect-new-cancel');
        const btnCreate  = document.getElementById('prospect-create');
        const btnClose   = document.getElementById('prospect-cancel');

        const badgeProspect  = document.getElementById('prospect-selected');
        const hiddenProspect = document.getElementById('prospect-select');

        const prospectIndex = new Map();
        const prospectLabel = (p) => {
          const email = (p.email || '').trim();
          const nom = (p.nom || '').trim();
          const pre = (p.prenom || '').trim();
          return `${nom} ${pre}${email ? ' — ' + email : ''} (#${p.id})`.trim();
        };

        function toggleProspectCreateMode(showForm) {
          formZone.style.display = showForm ? '' : 'none';
          listZone.style.display = showForm ? 'none' : '';
          (showForm ? document.getElementById('pnew-nom') : inputProspect)?.focus();
        }

        async function refreshProspectsOptions(q = '') {
          const rows = await window.electronAPI.listProspects({
            q: q ? q : null,
            status: ['actif', 'invite'],
            limit: 500
          });

          datalistProspects.innerHTML = (rows || [])
            .map(p => `<option value="${prospectLabel(p)}">`)
            .join('');

          prospectIndex.clear();
          (rows || []).forEach(p => {
            prospectIndex.set(prospectLabel(p), p);
          });

          hintProspect.textContent = `${rows?.length || 0} prospect(s) — tape pour filtrer…`;
        }

        btnPickProspect?.addEventListener('click', async (e) => {
          e.preventDefault();
          toggleProspectCreateMode(false);
          await refreshProspectsOptions('');
          popProspect.style.display = 'flex';
          setTimeout(() => inputProspect?.focus(), 50);
        });
        btnClose?.addEventListener('click', () => { popProspect.style.display = 'none'; });

        inputProspect?.addEventListener('input', (e) => {
          const q = (e.target.value || '').trim();
          refreshProspectsOptions(q);
        });

        inputProspect?.addEventListener('change', () => {
          const v = inputProspect.value.trim();
          const p = prospectIndex.get(v);
          if (!p) return;

          hiddenProspect.value = String(p.id);
          hiddenProspect.dataset.email = p.email || '';
          const label =
            `${(p.nom || '').trim()} ${(p.prenom || '').trim()}`.trim() +
            (p.email ? ` · ${p.email}` : '');
          if (badgeProspect) {
            badgeProspect.textContent = label;
            badgeProspect.style.display = '';
          }

          selectedProspect = { id: p.id, email: p.email || '', nom: p.nom || '', prenom: p.prenom || '' };
          localStorage.setItem('selectedProspect', JSON.stringify(selectedProspect));

          // effacer adhérent si présent
          const hiddenAdh = document.getElementById('adherent-select');
          const inputAdh  = document.getElementById('adherent-input');
          if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
          if (inputAdh)   { inputAdh.value = ''; }
          adherentSelectionneId = '';
          localStorage.removeItem('adherentId');

          popProspect.style.display = 'none';
          document.getElementById('search-produit')?.focus();
        });

        btnNew?.addEventListener('click', () => toggleProspectCreateMode(true));
        btnNewBack?.addEventListener('click', () => toggleProspectCreateMode(false));

        btnCreate?.addEventListener('click', async () => {
          const payload = {
            nom:       document.getElementById('pnew-nom')?.value.trim() || '',
            prenom:    document.getElementById('pnew-prenom')?.value.trim() || '',
            email:     document.getElementById('pnew-email')?.value.trim() || '',
            telephone: document.getElementById('pnew-tel')?.value.trim() || '',
            ville:     document.getElementById('pnew-ville')?.value.trim() || '',
            code_postal: document.getElementById('pnew-cp')?.value.trim() || '',
            adresse:   document.getElementById('pnew-adresse')?.value.trim() || '',
            note:      document.getElementById('pnew-note')?.value.trim() || '',
            status: 'actif'
          };
          if (!(payload.nom || payload.prenom || payload.email)) {
            alert('Indique au moins un nom/prénom ou un email.');
            return;
          }
          try {
            const created = await window.electronAPI.createProspect(payload);
            if (!created?.id) throw new Error('Création impossible');

            hiddenProspect.value = String(created.id);
            hiddenProspect.dataset.email = created.email || '';
            const badgeText =
              `${(created.nom || '').trim()} ${(created.prenom || '').trim()}`.trim() +
              (created.email ? ` · ${created.email}` : '');
            const badgePros = document.getElementById('prospect-selected');
            if (badgePros) {
              badgePros.textContent = badgeText;
              badgePros.style.display = '';
            }

            const hiddenAdh = document.getElementById('adherent-select');
            if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }

            popProspect.style.display = 'none';
            document.getElementById('search-produit')?.focus();
          } catch (e) {
            console.error(e);
            alert("Erreur lors de la création du prospect.");
          }
        });
      }

      // Bouton Acompte (utiliser showTextPromptModal)
      const btnAcompte = document.getElementById('btn-acompte');
      if (btnAcompte) {
        btnAcompte.addEventListener('click', async () => {
          const saisie = await showTextPromptModal("Montant de l'acompte à déduire (en €)", '5');
          if (saisie == null) return;
          const montant = Math.abs(parseFloat(String(saisie).replace(',', '.')));
          if (!montant || isNaN(montant) || montant <= 0) {
            alert('Montant invalide.');
            return;
          }
          panier.push({
            id: `acompte-${Date.now()}`,
            type: 'acompte',
            nom: 'Acompte utilisé',
            prix: -montant,
            quantite: 1
          });
          afficherPanier();
          sauvegarderPanier();
          document.getElementById('search-produit')?.focus();
        });
      }

      // 🗑️ suppression ligne (délégation)
      const tbody = document.querySelector('#panier-liste tbody');
      if (tbody) {
        tbody.addEventListener('click', (e) => {
          const btn = e.target.closest('.btn-supprimer-produit');
          if (!btn) return;
          e.preventDefault();
          const idx = parseInt(btn.dataset.index, 10);
          if (Number.isInteger(idx) && idx >= 0 && idx < panier.length) {
            panier.splice(idx, 1);
            if (typeof sauvegarderPanier === 'function') sauvegarderPanier();
            afficherPanier();
          }
        });
      }

      // Chevron datalist adhérents
      if (adherentsOn) {
        wireDatalistChevron('adherent-input');
      }

      // 🔁 Quantité
      document.querySelectorAll('.input-quantite').forEach(input => {
        input.addEventListener('change', (e) => {
          const i = parseInt(e.target.dataset.index, 10);
          const qte = parseFloat(e.target.value);
          if (!isNaN(qte) && qte > 0) {
            panier[i].quantite = qte;
            afficherPanier();
            sauvegarderPanier();
            document.getElementById('search-produit')?.focus();
          }
        });
      });

      // ⛔ décimales interdites pour "pièce"
      document.querySelectorAll('.input-quantite').forEach(input => {
        const i = parseInt(input.dataset.index, 10);
        const unite = panier[i]?.unite?.toLowerCase();
        if (unite === 'pièce') {
          input.addEventListener('keydown', (e) => {
            if (e.key === '.' || e.key === ',' || e.key === 'Decimal') e.preventDefault();
          });
          input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^\d]/g, '');
          });
        }
      });

      // 🧮 Remise (%) — ENTIER 0..100
      document.querySelectorAll('.input-remise').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (['.', ',', 'e', 'E', '-', '+', 'Decimal'].includes(e.key)) e.preventDefault();
        });
        input.addEventListener('input', (e) => {
          e.target.value = e.target.value.replace(/[^\d]/g, '');
        });
        input.addEventListener('change', (e) => {
          const i = parseInt(e.target.dataset.index, 10);
          let val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 0) val = 0;
          if (val > 100) val = 100;
          e.target.value = String(val);
          panier[i].remise = val;
          afficherPanier();
          sauvegarderPanier();
          document.getElementById('search-produit')?.focus();
        });
      });

      document.getElementById('btn-hold')?.addEventListener('click', async () => {
        const modulesNow = await (window.getMods?.() || window.electronAPI.getModules());
        let selectedProspectNow = null; try { selectedProspectNow = JSON.parse(localStorage.getItem('selectedProspect') || 'null'); } catch { }
        const saleModeNow = localStorage.getItem('saleMode') || (modulesNow.adherents ? 'adherent' : 'exterieur');
        await holdCurrentCart(modulesNow, saleModeNow, localStorage.getItem('adherentId') || '', selectedProspectNow, window.panier || []);
      });

      document.getElementById('btn-load')?.addEventListener('click', async () => {
        await showLoadCartDialog();
        afficherPanier();
        afficherProduits();
      });

      // Sélecteur de mode de vente
      document.querySelectorAll('input[name="vente-mode"]').forEach(r => {
        r.addEventListener('change', () => {
          saleMode = r.value;
          localStorage.setItem('saleMode', saleMode);

          const adhCont = document.getElementById('adherent-container');
          const extCont = document.getElementById('ext-container');
          const miniPros = document.getElementById('prospect-mini');

          if (saleMode === 'adherent' && adherentsOn) {
            adhCont && (adhCont.style.display = '');
            miniPros && (miniPros.style.display = '');
            extCont && (extCont.style.display = 'none');
          } else {
            adhCont && (adhCont.style.display = 'none');
            miniPros && (miniPros.style.display = 'none');
            extCont && (extCont.style.display = '');

            // Effacer adhérent + prospect
            const hiddenAdh = document.getElementById('adherent-select');
            if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
            adherentSelectionneId = '';
            localStorage.removeItem('adherentId');

            try { selectedProspect = null; } catch { }
            localStorage.removeItem('selectedProspect');
            const hp = document.getElementById('prospect-select');
            if (hp) { hp.value = ''; hp.dataset.email = ''; }
            const bp = document.getElementById('prospect-selected');
            if (bp) { bp.style.display = 'none'; bp.textContent = ''; }
          }

          afficherPanier(); // recalcul prix ext/adherent
        });
      });

      // Sauver l'email “ext”
      const extEmailInput = document.getElementById('ext-email');
      if (extEmailInput) {
        extEmailInput.addEventListener('input', () => {
          localStorage.setItem('extEmail', extEmailInput.value.trim());
        });
      }

      // 👤 Adhérent : datalist → hidden (si module ON)
      if (adherentsOn) {
        const labelAdh = (a) => {
          const email = (a.email1 || a.email2 || '').trim();
          return `${a.nom} ${a.prenom}${email ? ' — ' + email : ''} (#${a.id})`;
        };
        const adhIndex = new Map(adherents.map(a => [labelAdh(a), a]));

        const inputAdh = document.getElementById('adherent-input');
        const hiddenAdh = document.getElementById('adherent-select');

        if (inputAdh && hiddenAdh) {
          if (adherentSelectionneId) {
            const a = adherents.find(x => String(x.id) === String(adherentSelectionneId));
            if (a) {
              inputAdh.value = labelAdh(a);
              hiddenAdh.value = String(a.id);
              hiddenAdh.dataset.email = (a.email1 || a.email2 || '').trim();
            }
          }

          inputAdh.addEventListener('change', async () => {
            const v = inputAdh.value.trim();
            const a = adhIndex.get(v);

            if (!a) {
              hiddenAdh.value = '';
              hiddenAdh.dataset.email = '';
              adherentSelectionneId = '';
              localStorage.removeItem('adherentId');
              return;
            }

            // ✅ Sélection de l'adhérent
            hiddenAdh.value = String(a.id);
            hiddenAdh.dataset.email = (a.email1 || a.email2 || '').trim();
            adherentSelectionneId = a.id;
            localStorage.setItem('adherentId', String(a.id));

            // ❌ exclusif : on efface prospect
            try { selectedProspect = null; } catch { }
            localStorage.removeItem('selectedProspect');
            const hp = document.getElementById('prospect-select');
            if (hp) { hp.value = ''; hp.dataset.email = ''; }
            const bp = document.getElementById('prospect-selected');
            if (bp) { bp.style.display = 'none'; bp.textContent = ''; }

            // Cotisation auto si module ON et mode "adherent" — SAUF statut partenaire/exempté
            const statut = String(a.statut || 'actif').toLowerCase();
            const skipCotisation = (statut === 'partenaire' || statut === 'exempté' || statut === 'exempte');

            if (cotisationsOn && saleMode === 'adherent' && !skipCotisation) {
              const dejaCotisation = panier.some(p => p.type === 'cotisation');
              if (!dejaCotisation) {
                const nomComplet = `${a.nom} ${a.prenom}`;
                await verifierCotisationAdherent(a.id, nomComplet, panier, afficherPanier);
              }
            } else {
              // on retire toute cotisation si statut dispensé
              if (skipCotisation) {
                const idx = panier.findIndex(p => p.type === 'cotisation');
                if (idx >= 0) {
                  panier.splice(idx, 1);
                  try { localStorage.setItem('panier', JSON.stringify(panier)); } catch {}
                  afficherPanier();
                }
              }
            }

            document.getElementById('search-produit')?.focus();
          });
        }
      }

      // Recalcul frais CB si MP change
      const modeSelect = document.getElementById('mode-paiement-select');
      if (modesOn && modeSelect) {
        modeSelect.addEventListener('change', () => {
          modeSelectionneId = modeSelect.value;
          afficherPanier();
          sauvegarderPanier();
        });
      }
    };

    // ====== VUE PRINCIPALE (search + filtres + colonnes) ======
    content.innerHTML = `
      <div class="caisse-topbar">
        <input type="text" id="search-produit" placeholder="🔍 Rechercher un produit..." style="flex: 1; padding: 8px; font-size: 1em;">
      </div>

      <div class="filters">
        <div class="filters-card">
          <div class="familles-bar pill-bar"></div>
          <div class="categories-bar chip-bar"></div>
        </div>
      </div>

      <div class="caisse-zone">
        <div id="produits-zone" class="produits-cards"></div>
        <div id="panier-zone"></div>
      </div>

      <!-- POPUP QUANTITÉ -->
      <div id="popup-quantite" class="modal-overlay" style="display:none;">
        <div class="modal">
          <h3 id="popup-produit-nom">Quantité</h3>
          <input type="number" id="quantite-input" step="0.01" min="0.01" />
          <div class="modal-actions">
            <button id="popup-valider">Valider</button>
            <button onclick="fermerPopup()">Annuler</button>
          </div>
        </div>
      </div>
    `;

    // styles filtres (inchangé)
    (function applyFiltersCSS() {
      const css = `
        .filters{margin:12px 0}
        .filters-card{
          background:#fff;border:1px solid #e7ebf3;border-radius:14px;padding:12px 14px;
          box-shadow:0 4px 14px rgba(0,0,0,.04)
        }
        .pill-bar,.chip-bar{display:flex;gap:10px;flex:1;flex-wrap:wrap}
        .familles-bar{ padding-bottom:8px; }

        .familles-bar .btn-fam{
          appearance:none;cursor:pointer;
          border:2px solid #d9e2f3;background:#f5f7fc;color:#253449;
          padding:10px 18px;border-radius:16px;font-weight:700;font-size:1rem;
          transition:transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease;
        }
        .familles-bar .btn-fam:hover{
          transform:translateY(-0.5px);
          box-shadow:0 6px 12px rgba(60,90,150,.10)
        }
        .familles-bar .btn-fam.active{
          background:#5b72b2;
          color:#fff;
          border-color:#4b639f;
          box-shadow:0 8px 16px rgba(75,99,159,.18)
        }
        .familles-bar .btn-fam:focus-visible{outline:3px solid rgba(91,114,178,.28);outline-offset:2px}
        .familles-bar .btn-fam[data-fam=""]::before{content:"☰";margin-right:8px}

        .categories-bar .btn-cat-square{
          appearance:none;cursor:pointer;
          border:2px solid #d9eee7;background:#f6fbf9;color:#1f4a44;
          padding:8px 14px;border-radius:12px;font-weight:700;font-size:.95rem;
          transition:transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease;
        }
        .categories-bar .btn-cat-square:hover{
          transform:translateY(-0.5px);
          box-shadow:0 6px 12px rgba(46,138,120,.10)
        }
        .categories-bar .btn-cat-square.active{
          background:#3a9f8c;
          color:#fff;
          border-color:#2f8a78;
          box-shadow:0 8px 16px rgba(47,138,120,.16)
        }
        .categories-bar .btn-cat-square:focus-visible{outline:3px solid rgba(58,159,140,.26);outline-offset:2px}

        @media (max-width: 900px){
          .filters-card{border-radius:12px;padding:10px}
          .familles-bar .btn-fam{padding:9px 14px;font-size:.95rem}
          .categories-bar .btn-cat-square{padding:7px 12px;font-size:.9rem}
        }`;
      let st = document.getElementById('caisse-filters-style');
      if (!st) { st = document.createElement('style'); st.id = 'caisse-filters-style'; document.head.appendChild(st); }
      st.textContent = css;
    })();

    // Barres de filtres
    function renderFamillesBar() {
      const wrap = document.querySelector('.familles-bar');
      if (!wrap) return;

      const familles = Array.from(new Set((produits || [])
        .map(p => p.famille_effective_nom)
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'fr'));

      wrap.innerHTML = [
        `<button class="btn-fam ${!familleActive ? 'active' : ''}" data-fam="">Toutes les familles</button>`,
        ...familles.map(f => `
          <button class="btn-fam ${familleActive === f ? 'active' : ''}" data-fam="${f}">${f}</button>
        `)
      ].join('');

      wrap.querySelectorAll('.btn-fam').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = btn.dataset.fam || '';

          if (f === '') {
            familleActive = null;
            showCatsAllFamilies = true;
          } else {
            if (familleActive === f) {
              familleActive = null;
              showCatsAllFamilies = false;
            } else {
              familleActive = f;
              showCatsAllFamilies = false;
            }
          }

          categorieActive = null;
          renderFamillesBar();
          renderCategoriesBar();
          afficherProduits();
        });
      });
    }

    function renderCategoriesBar() {
      const wrap = document.querySelector('.categories-bar');
      if (!wrap) return;

      let cats = [];

      if (familleActive) {
        cats = Array.from(new Set((produits || [])
          .filter(p => p.famille_effective_nom === familleActive)
          .map(p => p.categorie_effective_nom)
          .filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, 'fr'));
      } else if (showCatsAllFamilies) {
        cats = Array.from(new Set((produits || [])
          .map(p => p.categorie_effective_nom)
          .filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, 'fr'));
      } else {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        return;
      }

      wrap.style.display = cats.length ? '' : 'none';
      wrap.innerHTML = cats.map(c => `
        <button class="btn-cat-square ${categorieActive === c ? 'active' : ''}" data-cat="${c}">${c}</button>
      `).join('');

      wrap.querySelectorAll('.btn-cat-square').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = btn.dataset.cat;
          categorieActive = (categorieActive === c) ? null : c;
          renderCategoriesBar();
          afficherProduits();
        });
      });
    }

    // premier rendu des barres
    renderFamillesBar();
    renderCategoriesBar();

    window.fermerPopup = fermerPopup;

    document.getElementById('search-produit').addEventListener('input', (e) => {
      const raw = e.target.value.trim();
      const rawLC = raw.toLowerCase();

      if (raw.length > 0) {
        familleActive = null;
        categorieActive = null;
        showCatsAllFamilies = false;
        document.querySelectorAll('.btn-cat-square').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.btn-fam').forEach(b => b.classList.remove('active'));
        renderFamillesBar();
        renderCategoriesBar();
      }

      // Ajout direct par code-barres si correspondance exacte
      const exactCB = produits.filter(p => (p.code_barre || '').toString().toLowerCase() === rawLC);
      if (raw && exactCB.length === 1) {
        const produit = exactCB[0];
        const unite = (produit.unite || '').toLowerCase();
        if (unite === 'kg' || unite === 'litre' || unite === 'l') {
          ouvrirPopupQuantite(produit);
        } else {
          ajouterAuPanier(produit, 1);
        }
        e.target.value = '';
        afficherProduits();
        return;
      }

      afficherProduits();
      renderFamillesBar();
      renderCategoriesBar();
    });

    document.getElementById('popup-valider').addEventListener('click', () => {
      const qte = parseFloat(document.getElementById('quantite-input').value);
      if (!isNaN(qte) && qte > 0 && produitEnCours) {
        ajouterAuPanier(produitEnCours, qte);
        fermerPopup();
        document.getElementById('search-produit')?.focus();
      }
    });
    document.getElementById('quantite-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('popup-valider').click();
    });
    document.getElementById('quantite-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') fermerPopup();
    });

    afficherProduits();
    afficherPanier();
    document.getElementById('search-produit')?.focus();

    // Expose viderPanier
    window.viderPanier = ({ skipConfirm = false } = {}) => {
      const selMP = document.getElementById('mode-paiement-select');
      const doitConfirmer = !skipConfirm && (panier.length > 0 || (selMP && selMP.value));

      if (doitConfirmer) {
        const ok = confirm('Souhaitez-vous vraiment vider tout le panier ?');
        if (!ok) return;
      }

      // 🧺 Vide le panier
      panier = [];
      window.panier = panier;
      localStorage.removeItem('panier');

      // 👤 Réinitialise la sélection d’adhérent
      localStorage.removeItem('adherentId');
      adherentSelectionneId = '';
      const hiddenAdh = document.getElementById('adherent-select');
      if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
      const inputAdh = document.getElementById('adherent-input');
      if (inputAdh) inputAdh.value = '';
      // Ticket actif
      currentCartId = null;
      try { localStorage.removeItem('currentCartId'); } catch { }
      // 🧲 Réinitialise prospect
      try { selectedProspect = null; } catch { }
      localStorage.removeItem('selectedProspect');
      const hiddenPros = document.getElementById('prospect-select');
      if (hiddenPros) { hiddenPros.value = ''; hiddenPros.dataset.email = ''; }
      const badgePros = document.getElementById('prospect-selected');
      if (badgePros) { badgePros.textContent = ''; badgePros.style.display = 'none'; }

      // 💳 Réinitialise mode de paiement
      const sel = document.getElementById('mode-paiement-select');
      if (sel) {
        sel.selectedIndex = 0;
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      modeSelectionneId = '';
      localStorage.removeItem('modePaiementId');

      // Mode par défaut après vidage
      if (adherentsOn) {
        saleMode = 'adherent';
      } else if (extOn) {
        saleMode = 'exterieur';
      } else {
        saleMode = 'adherent';
      }
      localStorage.setItem('saleMode', saleMode);

      const radioAdh = document.querySelector('input[name="vente-mode"][value="adherent"]');
      const radioExt = document.querySelector('input[name="vente-mode"][value="exterieur"]');
      if (radioAdh) radioAdh.checked = (saleMode === 'adherent');
      if (radioExt) radioExt.checked = (saleMode === 'exterieur');

      const adhCont = document.getElementById('adherent-container');
      const miniPros = document.getElementById('prospect-mini');
      const extCont = document.getElementById('ext-container');

      if (saleMode === 'adherent' && adherentsOn) {
        if (adhCont) adhCont.style.display = '';
        if (miniPros) miniPros.style.display = '';
        if (extCont) extCont.style.display = 'none';
      } else {
        if (adhCont) adhCont.style.display = 'none';
        if (miniPros) miniPros.style.display = 'none';
        if (extCont) extCont.style.display = '';
      }

      const extEmail = document.getElementById('ext-email');
      if (extEmail) extEmail.value = '';
      localStorage.removeItem('extEmail');

      afficherPanier();
      document.getElementById('search-produit')?.focus();
    };

  } // fin renderCaisse

  // ───────────────────────────────────────────────────────────
  // Validation de la vente (inchangée sauf petit nettoyage minime)
  // ───────────────────────────────────────────────────────────
  async function validerVente() {
    try {
      const modules = await (window.getMods?.() || window.electronAPI.getModules());
      const adherentsOn   = !!modules.adherents;
      const prospectsOn   = !!modules.prospects;
      const cotisationsOn = !!(modules.adherents && modules.cotisations);
      const extOn         = !!modules.ventes_exterieur;
      const modesOn       = !!modules.modes_paiement;

      const saleMode = localStorage.getItem('saleMode') || (adherentsOn ? 'adherent' : 'exterieur');
      const isExt = extOn && (saleMode === 'exterieur');

      let extMargin = 30;
      try {
        if (window.electronAPI.getVentesMargin) {
          const r = await window.electronAPI.getVentesMargin();
          const v = Number(r?.percent);
          if (Number.isFinite(v) && v >= 0) extMargin = v;
        } else {
          const cfg = await window.electronAPI.getConfig();
          const v = Number(cfg?.ventes_ext_margin_percent);
          if (Number.isFinite(v) && v >= 0) extMargin = v;
        }
      } catch { }
      const factor = isExt ? (1 + extMargin / 100) : 1;

      const panier = Array.isArray(window.panier) ? window.panier : [];
      if (panier.length === 0) {
        alert('Panier vide !');
        return;
      }

      // 3) Mode de paiement
      const selectMP = document.getElementById('mode-paiement-select');
      const mode_paiement_id = modesOn ? (Number(selectMP?.value || 0) || null) : null;
      const mode_paiement_label = modesOn ? (selectMP?.selectedOptions?.[0]?.textContent?.trim() || '') : '';
      if (modesOn && !mode_paiement_id) {
        alert('Merci de choisir un mode de paiement.');
        return;
      }

      // 4) Type de vente + destinataire
      let sale_type = 'adherent';
      let adherentId = null;
      let adherentEmail = null;
      let clientEmailExt = null;
      let _prospectSelectedForSale = null;

      if (isExt) {
        sale_type = 'exterieur';
        clientEmailExt = (document.getElementById('ext-email')?.value || '').trim() || null;
      } else if (adherentsOn) {
        const hiddenAdh = document.getElementById('adherent-select');
        const adhIdRaw = hiddenAdh?.value || '';
        const adhMail = hiddenAdh?.dataset?.email || '';

        if (adhIdRaw && adhMail) {
          sale_type = 'adherent';
          adherentId = Number(adhIdRaw);
          adherentEmail = adhMail;
        } else if (prospectsOn) {
          const hp = document.getElementById('prospect-select');
          const prospectId = hp?.value || '';
          const prospectEmail = hp?.dataset?.email || '';
          if (!prospectId) {
            alert('Merci de sélectionner un adhérent, ou bien un prospect, ou passe en mode Extérieur.');
            return;
          }
          sale_type = 'prospect';
          adherentId = null;
          _prospectSelectedForSale = { id: Number(prospectId), email: (prospectEmail || null) };
        } else {
          alert('Merci de sélectionner un adhérent (ou active le module prospects / passe en Extérieur).');
          return;
        }
      } else {
        sale_type = 'exterieur';
        clientEmailExt = (document.getElementById('ext-email')?.value || '').trim() || null;
      }

      // Lignes vendables
      const lignesProduits = panier
        .filter(p =>
          p &&
          p.type !== 'cotisation' &&
          p.type !== 'acompte' &&
          Number.isFinite(Number(p.id))
        );

      if (!lignesProduits.length) {
        console.error('[validerVente] Aucune ligne produit après filtrage, window.panier =', window.panier);
        alert('Aucune ligne de vente (ticket vide ou lignes invalides). Rouvre le ticket ou ajoute un produit.');
        return;
      }

      const sousTotalProduits = lignesProduits.reduce((s, p) => {
        const remise = Number(p.remise || 0);
        const puApplique = Number(p.prix) * factor * (1 - remise / 100);
        return s + puApplique * Number(p.quantite || 0);
      }, 0);

      const totalCotisation = (!isExt && cotisationsOn ? panier : [])
        .filter(p => p.type === 'cotisation')
        .reduce((s, p) => s + Number(p.prix) * Number(p.quantite || 1), 0);

      const totalAcompte = panier
        .filter(p => p.type === 'acompte')
        .reduce((s, p) => s + Math.abs(Number(p.prix) * Number(p.quantite || 1)), 0);

      let frais_paiement = 0;
      if (modesOn) {
        const taux = parseFloat(selectMP?.selectedOptions?.[0]?.dataset?.taux || '0');
        const fixe = parseFloat(selectMP?.selectedOptions?.[0]?.dataset?.fixe || '0');
        const baseNet = Math.max(0, sousTotalProduits - totalAcompte);
        frais_paiement = Math.round(((baseNet * (taux / 100)) + fixe) * 100) / 100;
      }

      const total = Math.round((sousTotalProduits + totalCotisation - totalAcompte + frais_paiement) * 100) / 100;

      // Lignes DB
      const lignes = lignesProduits.map(p => {
        const remise = Number(p.remise || 0);
        const puOrig = Number(p.prix);
        const puApplique = puOrig * factor * (1 - remise / 100);
        return {
          produit_id: Number(p.id),
          quantite: Number(p.quantite || 0),
          prix: Number(puApplique.toFixed(4)),       // PU appliqué
          prix_unitaire: Number(puOrig.toFixed(4)),  // PU original
          remise_percent: Number(remise.toFixed(4))
        };
      });

      if (!lignes.length) {
        console.error('[validerVente] Aucune ligne à envoyer au backend, lignesProduits =', lignesProduits);
        alert('Aucune ligne de vente valide.');
        return;
      }

      const _payloadVente = {
        total: Number(total || 0),
        adherent_id: (sale_type === 'adherent' && Number.isFinite(Number(adherentId))) ? Number(adherentId) : null,
        cotisation: (sale_type === 'adherent' && cotisationsOn) ? Number(totalCotisation || 0) : 0,
        mode_paiement_id: (modesOn && Number.isFinite(Number(mode_paiement_id))) ? Number(mode_paiement_id) : null,
        mode_paiement_label,
        frais_paiement,
        sale_type,
        client_email: (sale_type === 'exterieur')
          ? (clientEmailExt || null)
          : (_prospectSelectedForSale?.email || adherentEmail || null),
        lignes
      };

      console.group('[DEBUG] validerVente() - payload');
      console.log('window.panier (au moment du clic):', window.panier);
      console.log('payload.lignes:', lignes);
      console.log('total/cotisation/frais:', { total, totalCotisation, frais_paiement });
      console.groupEnd();

      // Loader
      if (typeof showLoader === 'function') showLoader('Enregistrement de la vente…');
      const started = Date.now();

      // Enregistrer la vente
      await window.electronAPI.enregistrerVente(_payloadVente);

      // Cotisation auto (si présente)
      try {
        if (adherentId && Number(totalCotisation) > 0) {
          await window.electronAPI.ajouterCotisation(Number(adherentId), Number(totalCotisation));
        }
      } catch (e) {
        console.error('[cotisation] ajout KO :', e);
      }

      // Envoi facture (si emails activés)
      const emailsOn = !!(modules.email || modules.emails);
      const prospectEmail = _prospectSelectedForSale?.email || null;
      const emailToSend = isExt
        ? (clientEmailExt || null)
        : (adherentEmail || prospectEmail || null);

      if (emailsOn && emailToSend) {
        try {
          await window.electronAPI.envoyerFactureEmail({
            email: emailToSend,
            lignes: lignesProduits.map(p => {
              const remise = Number(p.remise || 0);
              const puOrig = Number(p.prix);
              const puApplique = puOrig * factor * (1 - remise / 100);
              return {
                nom: p.nom,
                fournisseur_nom: p.fournisseur_nom || '',
                unite: p.unite || '',
                quantite: p.quantite,
                prix: Number(puApplique.toFixed(2)),
                prix_unitaire: Number(puOrig.toFixed(2)),
                remise_percent: Number(remise.toFixed(2))
              };
            }),
            cotisation: (!isExt) ? panier.filter(p => p.type === 'cotisation') : [],
            acompte: totalAcompte,
            frais_paiement,
            mode_paiement: selectMP?.selectedOptions?.[0]?.textContent || '',
            total
          });
        } catch (e) {
          console.warn('Envoi email échoué, vente quand même validée :', e);
        }
      }

      // Suppression ticket si existant
      try {
        const id = window.currentCartId || localStorage.getItem('currentCartId');
        if (id && window.carts?.delete) {
          await window.carts.delete(id);
        }
        window.currentCartId = null;
        try { localStorage.removeItem('currentCartId'); } catch { }
      } catch (e) {
        console.warn('[carts] suppression ticket post-vente — non bloquant:', e);
      }

      const elapsed = Date.now() - started;
      if (elapsed < 1000) await new Promise(res => setTimeout(res, 1000 - elapsed));
      if (typeof hideLoader === 'function') hideLoader();

      alert('Vente enregistrée ✅');
      viderPanier({ skipConfirm: true });
      document.getElementById('search-produit')?.focus();

    } catch (err) {
      console.error('Erreur validerVente:', err);
      try { if (typeof hideLoader === 'function') hideLoader(); } catch { }
      alert('Erreur pendant la validation de la vente. Consulte la console.');
    }
  }

  // ❗ Export
  window.PageCaisse = { renderCaisse, validerVente };
  window.validerVente = validerVente;
  window.renderCaisse = renderCaisse;
})();
