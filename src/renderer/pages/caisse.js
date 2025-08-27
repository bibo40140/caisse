// src/renderer/pages/caisse.js
(function () {
  // petite utilitaire pour temporiser le loader
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // 👉 DÉFINIS ici la VRAIE fonction renderCaisse
  async function renderCaisse() {
    // 🔧 Lire la config modules d'abord
    const modules = await (window.getMods?.() || window.electronAPI.getModules());
    const adherentsOn   = !!modules.adherents;
    const cotisationsOn = !!(modules.adherents && modules.cotisations);
    const extOn         = !!modules.ventes_exterieur;
    const prospectsOn   = !!modules.prospects; 
	const modesOn       = !!modules.modes_paiement;




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
    } catch {}
    const extFactor = 1 + (extMargin / 100);
    // Libellé dynamique pour le bouton radio "Extérieur"
    const fmtPct = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.00$/,''));
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
    // 👥 On ne charge les adhérents que si le module est ON
    const adherents  = adherentsOn ? (await window.electronAPI.getAdherents()) : [];
	const modes = modesOn ? (await window.electronAPI.getModesPaiement()) : [];

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
    try { selectedProspect = JSON.parse(localStorage.getItem('selectedProspect') || 'null'); } catch {}

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

    // Helpers de recherche : minuscules, sans accents, et sans "s" final
    const _norm = (s) =>
      (s || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const _sing = (s) => s.replace(/s\b/g, '');
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
      // (facultatif, tu réinitialises déjà ces filtres à la saisie)
      if (!matchFamCat(p)) return false;

      const hay = [
        _norm(p.nom || ''),
        _norm(p.fournisseur_nom || ''),
        String(p.code_barre || '')
      ].join(' ');
      return toks.every(t => hay.includes(t));
    }); // ← pas de filtre stock ici
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
        if (p.type === 'acompte')    return Number(p.prix) * Number(p.quantite || 1); // négatif
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
        <div id="adherent-container" style="${saleMode==='adherent' && adherentsOn ? '' : 'display:none;'}">
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
          ? `${(selectedProspect.nom||'').trim()} ${(selectedProspect.prenom||'').trim()}${selectedProspect.email ? ' · ' + selectedProspect.email : ''}`.trim()
          : '';

      const prospectMiniHtml = (!prospectsOn || !adherentsOn) ? '' : `
        <div id="prospect-mini" data-feature="prospects" style="${(saleMode==='adherent') ? '' : 'display:none;'}; margin-top:6px;">
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
              ${saleMode==='adherent'?'checked':''}> Adhérent</label>
            <label><input type="radio" name="vente-mode" value="exterieur"
              ${saleMode==='exterieur'?'checked':''}> Extérieur ${extPctLabel}</label>
          </div>
        `;
      } else {
        modeHtml = '';
      }

      const extHtml = `
        <div id="ext-container" style="${(modules.ventes_exterieur && saleMode==='exterieur') ? '' : 'display:none;'}">
          <label for="ext-email" style="font-weight:600;">📧 E-mail (optionnel)</label>
          <input type="email" id="ext-email" placeholder="client@example.com" value="${localStorage.getItem('extEmail')||''}">
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
                const ligneTotal = totalLigne(p);

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
            ${cotisationsOn && totalCotisation > 0
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
            </div>
          </div>
        </div>

        ${prospectPopupHtml}
      `;

      // ---- Prospects (popup + wiring type 'datalist') — UNIQUEMENT si module ON ----
      if (prospectsOn) {
        const btnPickProspect     = document.getElementById('pick-prospect');
        const popProspect         = document.getElementById('popup-prospect');
        const listZone            = document.getElementById('prospect-list-zone');
        const formZone            = document.getElementById('prospect-new-form');
        const inputProspect       = document.getElementById('prospect-combo');
        const datalistProspects   = document.getElementById('prospects-list');
        const hintProspect        = document.getElementById('prospect-hint');

        const btnNew              = document.getElementById('prospect-new');
        const btnNewBack          = document.getElementById('prospect-new-cancel');
        const btnCreate           = document.getElementById('prospect-create');
        const btnClose            = document.getElementById('prospect-cancel');

        const badgeProspect  = document.getElementById('prospect-selected');
        const hiddenProspect = document.getElementById('prospect-select');

        // Index label -> prospect (comme pour adhérents)
        const prospectIndex = new Map();
        const prospectLabel = (p) => {
          const email = (p.email || '').trim();
          const nom   = (p.nom || '').trim();
          const pre   = (p.prenom || '').trim();
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
            status: ['actif','invite'],
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

        // Ouverture/fermeture
        btnPickProspect?.addEventListener('click', async (e) => {
          e.preventDefault();
          toggleProspectCreateMode(false);
          await refreshProspectsOptions('');
          popProspect.style.display = 'flex';
          setTimeout(() => inputProspect?.focus(), 50);
        });
        btnClose?.addEventListener('click', () => { popProspect.style.display = 'none'; });

        // Saisie → recharge options
        inputProspect?.addEventListener('input', (e) => {
          const q = (e.target.value || '').trim();
          refreshProspectsOptions(q);
        });

        // Validation d’un choix
        inputProspect?.addEventListener('change', () => {
          const v = inputProspect.value.trim();
          const p = prospectIndex.get(v);
          if (!p) return;

          // maj hidden + badge
          const badgeProspect  = document.getElementById('prospect-selected');
          const hiddenProspect = document.getElementById('prospect-select');
          hiddenProspect.value = String(p.id);
          hiddenProspect.dataset.email = p.email || '';
          const label =
            `${(p.nom || '').trim()} ${(p.prenom || '').trim()}`.trim() +
            (p.email ? ` · ${p.email}` : '');
          if (badgeProspect) {
            badgeProspect.textContent = label;
            badgeProspect.style.display = '';
          }

          // 👉 persiste le prospect sélectionné
          selectedProspect = { id: p.id, email: p.email || '', nom: p.nom || '', prenom: p.prenom || '' };
          localStorage.setItem('selectedProspect', JSON.stringify(selectedProspect));

          // ❌ efface la sélection adhérent
          const hiddenAdh = document.getElementById('adherent-select');
          const inputAdh  = document.getElementById('adherent-input');
          if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
          if (inputAdh)  { inputAdh.value = ''; }
          adherentSelectionneId = '';
          localStorage.removeItem('adherentId');

          popProspect.style.display = 'none';
          document.getElementById('search-produit')?.focus();
        });

        // Basculer en mode création / retour
        btnNew?.addEventListener('click', () => toggleProspectCreateMode(true));
        btnNewBack?.addEventListener('click', () => toggleProspectCreateMode(false));

        // Création d’un prospect
        btnCreate?.addEventListener('click', async () => {
          const payload = {
            nom:        document.getElementById('pnew-nom')?.value.trim() || '',
            prenom:     document.getElementById('pnew-prenom')?.value.trim() || '',
            email:      document.getElementById('pnew-email')?.value.trim() || '',
            telephone:  document.getElementById('pnew-tel')?.value.trim() || '',
            ville:      document.getElementById('pnew-ville')?.value.trim() || '',
            code_postal:document.getElementById('pnew-cp')?.value.trim() || '',
            adresse:    document.getElementById('pnew-adresse')?.value.trim() || '',
            note:       document.getElementById('pnew-note')?.value.trim() || '',
            status:     'actif'
          };
          if (!(payload.nom || payload.prenom || payload.email)) {
            alert('Indique au moins un nom/prénom ou un email.');
            return;
          }
          try {
            const created = await window.electronAPI.createProspect(payload);
            if (!created?.id) throw new Error('Création impossible');

            // Pré-sélectionner le nouveau prospect
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

            // Nettoyer une sélection adhérent
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

      // ——— Bouton "➕ Acompte" ———
      const btnAcompte = document.getElementById('btn-acompte');
      if (btnAcompte) {
        btnAcompte.addEventListener('click', async () => {
          const saisie = await showPromptModal("Montant de l'acompte à déduire (en €)", '5');
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

      // ——— Abonnement au clic sur "🗑️" (délégation au tbody) ———
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

      // 👉 Chevron de la datalist uniquement si module ON
      if (adherentsOn) {
        wireDatalistChevron('adherent-input');
      }

      // 🎯 TOOLTIP tableau
      const tooltip = document.getElementById('tooltip-global');
      document.querySelectorAll('.cell-produit').forEach(cell => {
        cell.addEventListener('mouseenter', () => {
          tooltip.innerText = cell.dataset.tooltip;
          tooltip.style.display = 'block';
        });
        cell.addEventListener('mousemove', (e) => {
          tooltip.style.top = `${e.pageY - 35}px`;
          tooltip.style.left = `${e.pageX + 10}px`;
        });
        cell.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });

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

      // ⛔ Saisie décimale interdite pour "pièce"
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

      // ——— Sélecteur de mode de vente ———
      document.querySelectorAll('input[name="vente-mode"]').forEach(r => {
        r.addEventListener('change', () => {
          saleMode = r.value;
          localStorage.setItem('saleMode', saleMode);

          const adhCont   = document.getElementById('adherent-container');
          const extCont   = document.getElementById('ext-container');
          const miniPros  = document.getElementById('prospect-mini');

          if (saleMode === 'adherent' && adherentsOn) {
            // Afficher la zone adhérent (+ mini-prospect), masquer Extérieur
            adhCont && (adhCont.style.display = '');
            miniPros && (miniPros.style.display = '');
            extCont && (extCont.style.display = 'none');
          } else {
            // Afficher Extérieur, masquer Adhérent + Prospect mini
            adhCont && (adhCont.style.display = 'none');
            miniPros && (miniPros.style.display = 'none');
            extCont && (extCont.style.display = '');

            // ❌ On efface TOUTE sélection d’adhérent
            const hiddenAdh = document.getElementById('adherent-select');
            if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
            adherentSelectionneId = '';
            localStorage.removeItem('adherentId');

            // ❌ Et TOUTE sélection de prospect
            try { selectedProspect = null; } catch {}
            localStorage.removeItem('selectedProspect');
            const hp = document.getElementById('prospect-select');     // hidden
            if (hp) { hp.value = ''; hp.dataset.email = ''; }
            const bp = document.getElementById('prospect-selected');   // badge
            if (bp) { bp.style.display = 'none'; bp.textContent = ''; }
          }

          afficherPanier(); // recalcul avec le bon facteur (ext/adherent)
        });
      });

      // Sauver l'email “ext” quand il change
      const extEmailInput = document.getElementById('ext-email');
      if (extEmailInput) {
        extEmailInput.addEventListener('input', () => {
          localStorage.setItem('extEmail', extEmailInput.value.trim());
        });
      }

      // 👤 Adhérent (datalist → hidden) → UNIQUEMENT si module ON
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

            // ❌ Exclusivité : on efface le prospect s’il y en avait un
            try { selectedProspect = null; } catch {}                 // au cas où la variable globale n’existe pas encore
            localStorage.removeItem('selectedProspect');
            const hp = document.getElementById('prospect-select');    // hidden
            if (hp) { hp.value = ''; hp.dataset.email = ''; }
            const bp = document.getElementById('prospect-selected');  // badge
            if (bp) { bp.style.display = 'none'; bp.textContent = ''; }

            // Cotisation auto si module ON et mode "adherent"
            if (cotisationsOn && saleMode === 'adherent') {
              const dejaCotisation = panier.some(p => p.type === 'cotisation');
              if (!dejaCotisation) {
                const nomComplet = `${a.nom} ${a.prenom}`;
                await verifierCotisationAdherent(a.id, nomComplet, panier, afficherPanier);
              }
            }

            document.getElementById('search-produit')?.focus();
          });
        }
      }

      // 🔄 Recalcul frais CB si mode de paiement change
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
(function applyFiltersCSS(){
  const css = `
  .filters{margin:12px 0}
  .filters-card{
    background:#fff;border:1px solid #e7ebf3;border-radius:14px;padding:12px 14px;
    box-shadow:0 4px 14px rgba(0,0,0,.04)
  }
  .pill-bar,.chip-bar{display:flex;gap:10px;flex:1;flex-wrap:wrap}

  /* petit offset sous les familles */
  .familles-bar{ padding-bottom:8px; } /* ⬅️ ajouté */

  /* — Familles : bleu ardoise doux — */
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

  /* — Catégories : vert sauge — */
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




    // ====== NOUVELLES BARRES DE FILTRES (familles + catégories) ======
function renderFamillesBar() {
  const wrap = document.querySelector('.familles-bar');
  if (!wrap) return;

  const familles = Array.from(new Set((produits || [])
    .map(p => p.famille_effective_nom)
    .filter(Boolean)))
    .sort((a,b) => a.localeCompare(b, 'fr'));

  wrap.innerHTML = [
    `<button class="btn-fam ${!familleActive?'active':''}" data-fam="">Toutes les familles</button>`,
    ...familles.map(f => `
      <button class="btn-fam ${familleActive===f?'active':''}" data-fam="${f}">${f}</button>
    `)
  ].join('');

wrap.querySelectorAll('.btn-fam').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.fam || '';

    if (f === '') {
      // "Toutes les familles" → pas de famille active + on veut voir TOUTES les sous-cats
      familleActive = null;
      showCatsAllFamilies = true;
    } else {
      if (familleActive === f) {
        // re-clic sur la même famille → on désélectionne et on replie les sous-cats
        familleActive = null;
        showCatsAllFamilies = false;
      } else {
        // famille choisie → on affiche SES sous-cats
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
    // Famille sélectionnée → sous-cats de CETTE famille
    cats = Array.from(new Set((produits || [])
      .filter(p => p.famille_effective_nom === familleActive)
      .map(p => p.categorie_effective_nom)
      .filter(Boolean)))
      .sort((a,b) => a.localeCompare(b, 'fr'));
  } else if (showCatsAllFamilies) {
    // "Toutes les familles" cliqué → sous-cats de TOUTES les familles
    cats = Array.from(new Set((produits || [])
      .map(p => p.categorie_effective_nom)
      .filter(Boolean)))
      .sort((a,b) => a.localeCompare(b, 'fr'));
  } else {
    // Pas de famille et on n’a pas cliqué "Toutes les familles" → on replie
    wrap.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = cats.length ? '' : 'none';
  wrap.innerHTML = cats.map(c => `
    <button class="btn-cat-square ${categorieActive===c?'active':''}" data-cat="${c}">${c}</button>
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

    // (🔥 SUPPRIMÉ) Anciennes fonctions renderFilters()/wireFilters()
    // et leurs appels => évite l'erreur innerHTML sur #families-bar / #categories-bar

    window.fermerPopup = fermerPopup;

    document.getElementById('search-produit').addEventListener('input', (e) => {
      const raw = e.target.value.trim();
      const rawLC = raw.toLowerCase();

      if (raw.length > 0) {
        // reset filtres quand on saisit
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
      const hiddenAdh = document.getElementById('adherent-select');
      if (hiddenAdh) { hiddenAdh.value = ''; hiddenAdh.dataset.email = ''; }
      const inputAdh = document.getElementById('adherent-input');
      if (inputAdh) inputAdh.value = '';

      // 🧲 Réinitialise la sélection de prospect (exclusivité stricte)
      try { selectedProspect = null; } catch {}
      localStorage.removeItem('selectedProspect');
      const hiddenPros = document.getElementById('prospect-select');
      if (hiddenPros) { hiddenPros.value = ''; hiddenPros.dataset.email = ''; }
      const badgePros = document.getElementById('prospect-selected');
      if (badgePros) { badgePros.textContent = ''; badgePros.style.display = 'none'; }

      // 💳 Réinitialise le mode de paiement
      const sel = document.getElementById('mode-paiement-select');
      if (sel) {
        sel.selectedIndex = 0;
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      modeSelectionneId = '';
      localStorage.removeItem('modePaiementId');

      // 🔄 Remettre le mode par défaut après vidage/validation
      if (adherentsOn) {
        saleMode = 'adherent';
      } else if (extOn) {
        saleMode = 'exterieur';
      } else {
        saleMode = 'adherent'; // fallback
      }
      localStorage.setItem('saleMode', saleMode);

      // ⭕ Met à jour les radios si elles existent
      const radioAdh = document.querySelector('input[name="vente-mode"][value="adherent"]');
      const radioExt = document.querySelector('input[name="vente-mode"][value="exterieur"]');
      if (radioAdh) radioAdh.checked = (saleMode === 'adherent');
      if (radioExt) radioExt.checked = (saleMode === 'exterieur');

      // 🧱 Affiche/masque les blocs correspondants
      const adhCont  = document.getElementById('adherent-container');
      const miniPros = document.getElementById('prospect-mini');
      const extCont  = document.getElementById('ext-container');

      if (saleMode === 'adherent' && adherentsOn) {
        if (adhCont)  adhCont.style.display  = '';
        if (miniPros) miniPros.style.display = '';
        if (extCont)  extCont.style.display  = 'none';
      } else {
        if (adhCont)  adhCont.style.display  = 'none';
        if (miniPros) miniPros.style.display = 'none';
        if (extCont)  extCont.style.display  = '';
      }

      // (Optionnel) on repart aussi d’un email extérieur vide
      const extEmail = document.getElementById('ext-email');
      if (extEmail) extEmail.value = '';
      localStorage.removeItem('extEmail');

      // UI
      afficherPanier();
      document.getElementById('search-produit')?.focus();
    };

  }

  async function validerVente() {
    try {
      const modules = await (window.getMods?.() || window.electronAPI.getModules());
      const cotisationsOn = !!(modules.adherents && modules.cotisations);
      const saleMode = localStorage.getItem('saleMode') || (modules.adherents ? 'adherent' : 'exterieur');
      const extOn = !!modules.ventes_exterieur;
      const isExt = extOn && (saleMode === 'exterieur');
	  const modesOn = !!modules.modes_paiement;
      var _prospectSelectedForSale = null; // ← ajouté

      // 🔢 lire la marge depuis main (fallback 30)
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
      } catch {}
      const factor = isExt ? (1 + extMargin / 100) : 1;

      // 1) Panier
      const panier = Array.isArray(window.panier) ? window.panier : [];
      if (panier.length === 0) { alert('Panier vide !'); return; }

      // 2) Mode de paiement (OBLIGATOIRE)
      const selectMP = document.getElementById('mode-paiement-select');
const mode_paiement_id = modesOn ? (Number(selectMP?.value || 0) || null) : null;
const mode_paiement_label = modesOn ? (selectMP?.selectedOptions?.[0]?.textContent?.trim() || '') : '';
if (modesOn && !mode_paiement_id) { alert('Merci de choisir un mode de paiement.'); return; }


      // 3) Adhérent / Extérieur (pas de double déclaration)
      let adherentId = null, adherentEmail = null, clientEmailExt = null;
      if (!isExt && modules.adherents) {
        const hiddenAdh = document.getElementById('adherent-select');
        adherentId    = hiddenAdh?.value || '';
        adherentEmail = hiddenAdh?.dataset?.email || '';
        if (!adherentId || !adherentEmail) {
          // 👉 autoriser si un prospect est sélectionné (mail optionnel)
          const hp = document.getElementById('prospect-select');
          const prospectId = hp?.value || '';
          const prospectEmail = hp?.dataset?.email || '';
          if (!prospectId) {
            alert('Merci de sélectionner un adhérent (ou choisissez un prospect via le lien sous le champ).');
            return;
          }
          // on utilisera l’email prospect si présent
          adherentId = null;
          adherentEmail = '';
          // on placera l’email prospect dans client_email plus bas
          // et on taguera la vente comme "prospect"
          var _prospectSelectedForSale = { id: Number(prospectId), email: prospectEmail || null };
        }
      } else {
        clientEmailExt = (document.getElementById('ext-email')?.value || '').trim() || null; // optionnel
      }

      // 4) Totaux (+30% uniquement sur produits)
      const lignesProduits = panier.filter(p => p.type !== 'cotisation' && p.type !== 'acompte');

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

      // 5) Lignes DB (PU appliqué = remise + éventuel +30%)
      const lignes = lignesProduits.map(p => {
        const remise = Number(p.remise || 0);
        const puOrig = Number(p.prix);
        const puApplique = puOrig * factor * (1 - remise / 100);
        return {
          produit_id: p.id,
          quantite: Number(p.quantite || 0),
          prix: Number(puApplique.toFixed(4)),      // PU appliqué
          prix_unitaire: Number(puOrig.toFixed(4)), // PU original
          remise_percent: Number(remise.toFixed(4))
        };
      });

      // 👉 On ne montre le loader qu'une fois tout est OK (pas de retour anticipé)
      showLoader('Enregistrement de la vente…');
      const started = Date.now();

      console.log('[payload vente]', {
  total, adherent_id: (!isExt && modules.adherents) ? Number(adherentId) : null,
  mode_paiement_id, frais_paiement, sale_type: (isExt ? 'exterieur' : (_prospectSelectedForSale ? 'prospect' : 'adherent')),
});


      // 6) Enregistrer la vente
      await window.electronAPI.enregistrerVente({
        total,
        adherent_id: (!isExt && modules.adherents) ? Number(adherentId) : null,
        cotisation: (!isExt) ? totalCotisation : 0,
        mode_paiement_id,
        mode_paiement_label,
        frais_paiement,
        sale_type: (isExt ? 'exterieur' : (_prospectSelectedForSale ? 'prospect' : 'adherent')),
        client_email: _prospectSelectedForSale
          ? (_prospectSelectedForSale.email || null)
          : (clientEmailExt || null),
        lignes
      });
      // ⬇️ Si une cotisation a été payée par un adhérent, on l'enregistre dans la table cotisations
try {
  if (adherentId && Number(totalCotisation) > 0) {
    await window.electronAPI.ajouterCotisation(Number(adherentId), Number(totalCotisation));
  }
} catch (e) {
  console.error('[cotisation] ajout KO :', e);
  // On ne bloque pas la vente si l’ajout de cotisation échoue,
  // mais on log l’erreur. Tu peux afficher un toast si tu veux.
}


      // 8) Envoi facture si email dispo (adhérent, prospect OU extérieur) + module emails
      const emailsOn = !!(modules.email || modules.emails);
      const prospectEmail = _prospectSelectedForSale?.email || null;

      // adresse finale à utiliser
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

      // ⏱️ Garantie affichage loader >= 1s
      const elapsed = Date.now() - started;
      if (elapsed < 1000) await sleep(1000 - elapsed);

      hideLoader();
      alert('Vente enregistrée ✅');
      viderPanier({ skipConfirm: true });
      document.getElementById('search-produit')?.focus();

    } catch (err) {
      console.error('Erreur validerVente:', err);
      try { hideLoader(); } catch {}
      alert('Erreur pendant la validation de la vente. Consulte la console.');
    }
  }

  // ❗ Export : on expose aussi window.renderCaisse car le routeur l'appelle
  window.PageCaisse   = { renderCaisse, validerVente };
  window.validerVente = validerVente;
  window.renderCaisse = renderCaisse; // 👈 bridge pour renderer.js
})();

