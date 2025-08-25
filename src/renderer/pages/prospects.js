// src/renderer/pages/prospects.js
(() => {
  async function renderProspectsPage() {
    const container = document.getElementById('parametres-souspage') || document.getElementById('page-content');

    // CSS (une seule fois)
    if (!document.getElementById('prospects-style')) {
      const st = document.createElement('style');
      st.id = 'prospects-style';
      st.textContent = `
        .pill{display:inline-block;font-size:12px;padding:2px 8px;border-radius:9999px;border:1px solid transparent}
        .pill.actif{background:#e8fff1;border-color:#bdeacc;color:#1f7a3a}
        .pill.invite{background:#eef3ff;border-color:#cfdcff;color:#2f53c7}
        .pill.venu_reunion{background:#fff7e6;border-color:#ffe0a3;color:#a86500}
        .pill.annule{background:#ffecec;border-color:#ffc9c9;color:#b42222}
        .pill.converti{background:#f0f0f0;border-color:#d9d9d9;color:#555}
        .muted{opacity:.7}
        .table-pros tr td, .table-pros tr th{border:1px solid #e6e6e6}
        .chips { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid #e6e6e6; border-radius:999px; font-size:12px; }
        .row-actions{ display:flex; gap:6px; flex-wrap:wrap; }
        .row-actions button{ padding:4px 8px; }
      `;
      document.head.appendChild(st);
    }

    container.innerHTML = `
      <h3>👤 Prospects</h3>

      <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap; margin-bottom:12px;">
        <div>
          <label>Recherche<br>
            <input id="pros-q" placeholder="Nom, email, ville, téléphone…" style="min-width:280px;">
          </label>
        </div>
        <div>
          <label>Statut<br>
            <select id="pros-status">
              <option value="">— Tous —</option>
              <option value="actif">Actif</option>
              <option value="invite">Invité</option>
              <option value="venu_reunion">Venu réunion</option>
              <option value="converti">Converti</option>
              <option value="annule">Annulé</option>
            </select>
          </label>
        </div>
        <button id="pros-add-btn">➕ Ajouter</button>
        <button id="pros-bulk-email">✉️ E-mail (sélection…)</button>
      </div>

      <div id="pros-list"></div>

      <!-- ===== POPUP PROSPECT (sélection / création) ===== -->
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
            <div class="muted" id="prospect-hint" style="font-size:12px;margin-top:6px;">
              Tape pour filtrer…
            </div>
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
            <div class="muted" style="font-size:12px; margin-top:6px;">
              (Au moins un <em>nom/prénom</em> ou un <em>email</em> est requis.)
            </div>
          </div>

          <!-- éléments compat caisse (inoffensifs ici) -->
          <span id="prospect-selected" style="display:none;"></span>
          <input type="hidden" id="prospect-select" value="" data-email="">
        </div>
      </div>

      <!-- ===== POPUP ENVOI GROUPÉ ===== -->
      <div id="popup-bulkmail" class="modal-overlay" style="display:none;">
        <div class="modal" style="max-width:760px;">
          <h3>✉️ Envoyer un e-mail aux prospects</h3>

          <div class="chips">
            <label class="chip"><input type="checkbox" id="bm-actif" checked> Actifs</label>
            <label class="chip"><input type="checkbox" id="bm-invite"> Invités</label>
            <label class="chip"><input type="checkbox" id="bm-venu"> Venus à la réunion</label>
          </div>

          <div style="margin-top:12px;">
            <label>📅 Date/heure de la réunion<br>
              <input id="bm-when" placeholder="ex.: mardi 12/11 à 19h (facultatif)" style="width:100%;">
            </label>
          </div>

          <div style="margin-top:12px;">
            <label>✉️ Objet<br>
              <input id="bm-subject" style="width:100%;" value="Invitation à la réunion d’information {{epicerie}}">
            </label>
          </div>

          <div style="margin-top:12px;">
            <label>📝 Message (template)<br>
              <textarea id="bm-body" rows="10" style="width:100%;">Bonjour {{prenom}} {{nom}},

Vous êtes venu à {{epicerie}} récemment. Vous êtes donc invité·e à la réunion d’information qui aura lieu le {{date_reunion}}.

Bonne journée,
Fabien</textarea>
            </label>
            <div class="muted" style="margin-top:6px;">
              Variables disponibles : {{nom}}, {{prenom}}, {{email}}, {{epicerie}}, {{date_reunion}}
            </div>
          </div>

          <div id="bm-stats" class="muted" style="margin-top:10px;"></div>

          <div class="modal-actions" style="justify-content: space-between; margin-top:12px;">
            <button id="bm-cancel">Fermer</button>
            <div>
              <button id="bm-preview">Prévisualiser destinataires</button>
              <button id="bm-send" class="btn-valider">🚀 Envoyer</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== POPUP ÉDITER PROSPECT ===== -->
      <div id="popup-prospect-edit" class="modal-overlay" style="display:none;">
        <div class="modal" style="max-width:720px;">
          <h3>📝 Éditer le prospect</h3>
          <input type="hidden" id="pedit-id">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <input id="pedit-nom"     placeholder="Nom">
            <input id="pedit-prenom"  placeholder="Prénom">
            <input id="pedit-email"   placeholder="Email">
            <input id="pedit-tel"     placeholder="Téléphone">
            <input id="pedit-ville"   placeholder="Ville">
            <input id="pedit-cp"      placeholder="Code postal">
            <input id="pedit-adresse" placeholder="Adresse" style="grid-column: span 2;">
            <textarea id="pedit-note" placeholder="Note…" style="grid-column: span 2; height:100px;"></textarea>
          </div>
          <div class="modal-actions" style="justify-content: space-between; margin-top:10px;">
            <button id="pedit-cancel">Fermer</button>
            <button id="pedit-save" class="btn-valider">💾 Enregistrer</button>
          </div>
        </div>
      </div>
    `;

    const pill = (status) => {
      const cls = ['actif','invite','venu_reunion','converti','annule'].includes(status) ? status : 'actif';
      const label = { actif:'Actif', invite:'Invité', venu_reunion:'Venu réunion', converti:'Converti', annule:'Annulé' }[status] || status;
      return `<span class="pill ${cls}">${label}</span>`;
    };

    // ——— Liste + wiring ———
    async function load() {
      const q = (document.getElementById('pros-q')?.value || '').trim();
      const status = (document.getElementById('pros-status')?.value || '').trim() || null;
      const rows = await window.electronAPI.listProspects({ q: q || null, status: status || null, limit: 500 });

      const list = document.getElementById('pros-list');
      if (!rows || rows.length === 0) {
        list.innerHTML = `<div class="muted">Aucun prospect.</div>`;
        return;
      }

      list.innerHTML = `
        <table class="table-pros" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;">
          <thead>
            <tr>
              <th style="width:18%;">Nom</th>
              <th style="width:18%;">Prénom</th>
              <th style="width:22%;">Email</th>
              <th style="width:14%;">Téléphone</th>
              <th style="width:12%;">Ville</th>
              <th style="width:10%;">Statut</th>
              <th style="width:16%;">Actions</th>
              <th style="width:16%;">Changer statut</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(p => `
              <tr data-id="${p.id}">
                <td>${(p.nom||'')}</td>
                <td>${(p.prenom||'')}</td>
                <td>${(p.email||'')}</td>
                <td>${(p.telephone||'')}</td>
                <td>${(p.ville||'')}</td>
                <td>${pill(p.status||'actif')}</td>
                <td class="row-actions">
                  <button class="btn-edit">✏️</button>
                  <button class="btn-del">🗑️</button>
                  <button class="btn-hist">📜</button>
                  <button class="btn-convert" ${p.status==='converti'?'disabled':''}>➡️ Convertir</button>
                </td>
                <td>
                  <select class="status-select">
                    <option value="actif" ${p.status==='actif'?'selected':''}>Actif</option>
                    <option value="invite" ${p.status==='invite'?'selected':''}>Invité</option>
                    <option value="venu_reunion" ${p.status==='venu_reunion'?'selected':''}>Venu réunion</option>
                    <option value="annule" ${p.status==='annule'?'selected':''}>Annulé</option>
                    <option value="converti" ${p.status==='converti'?'selected':''} disabled>Converti</option>
                  </select>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      // Délégation
      const tbody = list.querySelector('tbody');
      tbody.onclick = async (e) => {
        const tr = e.target.closest('tr'); if (!tr) return;
        const id = Number(tr.dataset.id);

        // Changer statut
        const sel = e.target.closest('.status-select');
        if (sel) {
          try { await window.electronAPI.markProspectStatus(id, sel.value); await load(); }
          catch (err) { console.error(err); alert("Impossible de changer le statut."); }
          return;
        }

        // Supprimer
        if (e.target.closest('.btn-del')) {
          if (!confirm('Supprimer ce prospect ?')) return;
          try { await window.electronAPI.deleteProspect(id); await load(); }
          catch (err) { console.error(err); alert("Suppression impossible."); }
          return;
        }

        // Éditer
        if (e.target.closest('.btn-edit')) {
          const p = rows.find(x => x.id === id);
          document.getElementById('pedit-id').value       = id;
          document.getElementById('pedit-nom').value      = p?.nom || '';
          document.getElementById('pedit-prenom').value   = p?.prenom || '';
          document.getElementById('pedit-email').value    = p?.email || '';
          document.getElementById('pedit-tel').value      = p?.telephone || '';
          document.getElementById('pedit-ville').value    = p?.ville || '';
          document.getElementById('pedit-cp').value       = p?.code_postal || '';
          document.getElementById('pedit-adresse').value  = p?.adresse || '';
          document.getElementById('pedit-note').value     = p?.note || '';
          document.getElementById('popup-prospect-edit').style.display = 'flex';
          return;
        }

        // Historique invitations
        if (e.target.closest('.btn-hist')) {
          try {
            const invits = await window.electronAPI.listProspectInvitations({ prospect_id: id, limit: 200 });
            document.getElementById('phist-target').textContent = `Prospect #${id}`;
            const box = document.getElementById('phist-list');
            if (!invits || invits.length === 0) {
              box.innerHTML = `<div class="muted" style="padding:8px;">Aucune invitation.</div>`;
            } else {
              box.innerHTML = invits.map(x => `
                <div style="padding:8px 10px; border-bottom:1px solid #eee;">
                  <div><strong>${x.subject || '(sans objet)'}</strong></div>
                  <div class="muted" style="font-size:12px;">
                    Envoyé le ${new Date(x.sent_at).toLocaleString()}${x.date_reunion ? ' — Réunion : '+x.date_reunion : ''}
                  </div>
                </div>
              `).join('');
            }
            document.getElementById('popup-prospect-hist').style.display = 'flex';
          } catch (err) {
            console.error(err);
            alert("Impossible de charger l'historique.");
          }
          return;
        }

        // Convertir → adhérent
        if (e.target.closest('.btn-convert')) {
          const ok = await window.showConfirmModal?.("Convertir ce prospect en adhérent ?") ?? confirm("Convertir ce prospect en adhérent ?");
          if (!ok) return;
          try {
            const res = await window.electronAPI.convertProspectToAdherent(id, null);
            if (res?.created) {
              alert(`Prospect converti ✅ — nouvel adhérent #${res.adherent_id}`);
            } else {
              alert(`Prospect converti ✅ — lié à l’adhérent #${res.adherent_id}`);
            }
            await load();
          } catch (err) {
            console.error(err);
            alert("Conversion impossible.");
          }
          return;
        }
      };
    }

    // Filtres
    document.getElementById('pros-q')?.addEventListener('input', load);
    document.getElementById('pros-status')?.addEventListener('change', load);

    // Popup “ajouter” (réutilise la même popup que la caisse)
    const ui = wireProspectPopupForParams(() => renderProspectsPage());
    document.getElementById('pros-add-btn')?.addEventListener('click', () => ui.openCreate());

    // ===== Envoi groupé
    const pm = document.getElementById('popup-bulkmail');
    const openBulk = () => { pm.style.display = 'flex'; calcStats(); };
    const closeBulk = () => { pm.style.display = 'none'; };

    document.getElementById('pros-bulk-email')?.addEventListener('click', openBulk);
    document.getElementById('bm-cancel')?.addEventListener('click', closeBulk);

    async function getSelectedRecipients() {
      const statuses = [];
      if (document.getElementById('bm-actif')?.checked) statuses.push('actif');
      if (document.getElementById('bm-invite')?.checked) statuses.push('invite');
      if (document.getElementById('bm-venu')?.checked) statuses.push('venu_reunion');
      const rows = await window.electronAPI.listProspects({ q: null, status: statuses.length ? statuses : null, limit: 5000 });
      return (rows || [])
        .map(p => ({ id: p.id, email: (p.email||'').trim(), nom: p.nom||'', prenom: p.prenom||'', status: p.status || '' }))
        .filter(x => !!x.email);
    }
    async function calcStats() {
      const r = await getSelectedRecipients();
      document.getElementById('bm-stats').textContent = `${r.length} destinataire(s) avec e-mail.`;
    }
    ['bm-actif','bm-invite','bm-venu'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', calcStats);
    });

    document.getElementById('bm-preview')?.addEventListener('click', async () => {
      const r = await getSelectedRecipients();
      alert(r.map(x => `${x.prenom} ${x.nom} <${x.email}>`).join('\n'));
    });

    document.getElementById('bm-send')?.addEventListener('click', async () => {
      const subject      = (document.getElementById('bm-subject')?.value || '').trim();
      const bodyTemplate = (document.getElementById('bm-body')?.value || '').trim();
      const dateReunion  = (document.getElementById('bm-when')?.value || '').trim();
      if (!subject || !bodyTemplate) { alert("Objet et message requis."); return; }

      const recipients = await getSelectedRecipients();
      if (recipients.length === 0) { alert("Aucun destinataire avec e-mail."); return; }

      try {
        const res = await window.electronAPI.prospectsSendBulkEmail({
          subject,
          bodyTemplate,
          recipients,                // {id,email,nom,prenom,status}
          date_reunion: dateReunion,
          updateStatus: true
        });
        alert(`✅ E-mail envoyé à ${res.sent} prospect(s).`);
        closeBulk();
        await load();
      } catch (e) {
        console.error(e);
        alert("Erreur d'envoi : " + (e?.message || e));
      }
    });

    // —— Popup EDIT : save / cancel
    document.getElementById('pedit-cancel')?.addEventListener('click', () => {
      document.getElementById('popup-prospect-edit').style.display = 'none';
    });
    document.getElementById('pedit-save')?.addEventListener('click', async () => {
      const payload = {
        id: Number(document.getElementById('pedit-id').value),
        nom:         document.getElementById('pedit-nom').value.trim(),
        prenom:      document.getElementById('pedit-prenom').value.trim(),
        email:       document.getElementById('pedit-email').value.trim(),
        telephone:   document.getElementById('pedit-tel').value.trim(),
        ville:       document.getElementById('pedit-ville').value.trim(),
        code_postal: document.getElementById('pedit-cp').value.trim(),
        adresse:     document.getElementById('pedit-adresse').value.trim(),
        note:        document.getElementById('pedit-note').value.trim(),
      };
      try {
        await window.electronAPI.updateProspect(payload);
        document.getElementById('popup-prospect-edit').style.display = 'none';
        await load();
      } catch (err) {
        console.error(err);
        alert("Échec de la mise à jour.");
      }
    });

    // —— Popup HIST : fermer
    document.getElementById('phist-close')?.addEventListener('click', () => {
      document.getElementById('popup-prospect-hist').style.display = 'none';
    });

    await load();

    // ============================================================
    // Popup Prospects (réutilisable) — avec correctif “liste qui se referme”
    // ============================================================
    function wireProspectPopupForParams(onCreated = null) {
      let justOpened = false;

      const popProspect       = document.getElementById('popup-prospect');
      const listZone          = document.getElementById('prospect-list-zone');
      const formZone          = document.getElementById('prospect-new-form');
      const inputProspect     = document.getElementById('prospect-combo');
      const datalistProspects = document.getElementById('prospects-list');
      const hintProspect      = document.getElementById('prospect-hint');

      const btnNew     = document.getElementById('prospect-new');
      const btnNewBack = document.getElementById('prospect-new-cancel');
      const btnCreate  = document.getElementById('prospect-create');
      const btnClose   = document.getElementById('prospect-cancel');

      const wrapProspect    = document.getElementById('prospect-wrap');
      const chevronProspect = document.getElementById('prospect-chevron');
      const menuProspects   = document.getElementById('prospects-menu');

      const hiddenProspect  = document.getElementById('prospect-select');
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
          q: q ? q : null, status: ['actif','invite'], limit: 500
        });

        datalistProspects.innerHTML = (rows || [])
          .map(p => `<option value="${prospectLabel(p)}">`).join('');

        prospectIndex.clear();
        (rows || []).forEach(p => prospectIndex.set(prospectLabel(p), p));

        hintProspect.textContent = `${rows?.length || 0} prospect(s) — tape pour filtrer…`;
      }

      function showProspectsMenu() { if (menuProspects) menuProspects.style.display = 'block'; }
      function hideProspectsMenu() { if (menuProspects) menuProspects.style.display = 'none'; }

      function renderProspectsMenu(rows = []) {
        if (!menuProspects) return;

        menuProspects.innerHTML = (rows || []).map(p => `
          <div class="pros-opt" data-id="${p.id}" data-email="${p.email || ''}"
               style="padding:8px 10px; border-bottom:1px solid #eee; cursor:pointer;">
            <div><strong>${(p.nom || '')} ${(p.prenom || '')}</strong></div>
            <div class="muted" style="font-size:12px;">${p.email || '—'}${p.ville ? ' · '+p.ville : ''}</div>
          </div>
        `).join('');

        // Empêche la fermeture en cliquant à l’intérieur du menu
        menuProspects.onclick = (e) => e.stopPropagation();

        // Sélection d’une ligne
        menuProspects.querySelectorAll('.pros-opt').forEach(opt => {
          opt.addEventListener('mousedown', (e) => e.preventDefault()); // évite de perdre le focus
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const id    = opt.getAttribute('data-id');
            const email = opt.getAttribute('data-email') || '';
            const p     = Array.from(prospectIndex.values()).find(x => String(x.id) === String(id));
            if (!p) return;

            if (hiddenProspect) {
              hiddenProspect.value = String(id);
              hiddenProspect.dataset.email = email;
            }
            inputProspect.value = prospectLabel(p);
            hideProspectsMenu();
            popProspect.style.display = 'none';
          });
        });
      }

      async function openFullProspectsMenu() {
        const rows = await window.electronAPI.listProspects({
          q: null, status: ['actif', 'invite'], limit: 500
        });
        prospectIndex.clear();
        (rows || []).forEach(p => prospectIndex.set(prospectLabel(p), p));
        renderProspectsMenu(rows || []);
        hintProspect.textContent = `${rows?.length || 0} prospect(s) — tape pour filtrer…`;
        showProspectsMenu();

        // Ignore le tout premier “outside click” juste après l’ouverture
        justOpened = true;
        setTimeout(() => { justOpened = false; }, 0);
      }

      // Ouvre au chevron
      chevronProspect?.addEventListener('pointerdown', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputProspect?.focus();
        await openFullProspectsMenu();
      });

      // Ouvre au focus du champ
      inputProspect?.addEventListener('focus', async () => {
        await openFullProspectsMenu();
      });

      // Ferme si clic en dehors (version pointerdown + garde-fou)
      if (!popProspect._outsideProsHandler) {
        popProspect._outsideProsHandler = (ev) => {
          if (justOpened) { justOpened = false; return; }
          const inside =
            wrapProspect?.contains(ev.target) ||
            menuProspects?.contains(ev.target);
          if (!inside) hideProspectsMenu();
        };
        document.addEventListener('pointerdown', popProspect._outsideProsHandler);
      }

      // Saisie → datalist (on masque le menu custom)
      inputProspect?.addEventListener('input', (e) => {
        hideProspectsMenu();
        const q = (e.target.value || '').trim();
        refreshProspectsOptions(q);
      });

      // Validation via datalist
      inputProspect?.addEventListener('change', () => {
        const v = inputProspect.value.trim();
        const p = prospectIndex.get(v);
        if (!p) return;
        if (hiddenProspect) {
          hiddenProspect.value = String(p.id);
          hiddenProspect.dataset.email = p.email || '';
        }
        popProspect.style.display = 'none';
      });

      // Boutons popup
      btnClose && (btnClose.onclick = () => { popProspect.style.display = 'none'; });
      btnNew && (btnNew.onclick = () => toggleProspectCreateMode(true));
      btnNewBack && (btnNewBack.onclick = () => toggleProspectCreateMode(false));

      // Création (anti double-clic)
      let creating = false;
      btnCreate && (btnCreate.onclick = async () => {
        if (creating) return;
        creating = true;
        try {
          const payload = {
            nom:         document.getElementById('pnew-nom')?.value.trim() || '',
            prenom:      document.getElementById('pnew-prenom')?.value.trim() || '',
            email:       document.getElementById('pnew-email')?.value.trim() || '',
            telephone:   document.getElementById('pnew-tel')?.value.trim() || '',
            ville:       document.getElementById('pnew-ville')?.value.trim() || '',
            code_postal: document.getElementById('pnew-cp')?.value.trim() || '',
            adresse:     document.getElementById('pnew-adresse')?.value.trim() || '',
            note:        document.getElementById('pnew-note')?.value.trim() || '',
            status:      'actif'
          };
          if (!(payload.nom || payload.prenom || payload.email)) {
            alert('Indique au moins un nom/prénom ou un email.');
            return;
          }
          const created = await window.electronAPI.createProspect(payload);
          if (!created?.id) throw new Error('Création impossible');

          popProspect.style.display = 'none';
          if (typeof onCreated === 'function') onCreated(created);
        } catch (e) {
          console.error(e);
          alert("Erreur lors de la création du prospect.");
        } finally {
          creating = false;
        }
      });

      // API publique
      async function openPopup()  {
        await refreshProspectsOptions('');
        toggleProspectCreateMode(false);
        popProspect.style.display = 'flex';
        setTimeout(() => inputProspect?.focus(), 50);
      }
      async function openCreate() {
        await refreshProspectsOptions('');
        toggleProspectCreateMode(true);
        popProspect.style.display = 'flex';
        setTimeout(() => document.getElementById('pnew-nom')?.focus(), 50);
      }
      return { openPopup, openCreate };
    }
  }

  // Expose
window.PageProspects = { render: renderProspectsPage };
})();
