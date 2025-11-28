#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re

file_path = r"c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse\src\renderer\pages\inventaire.js"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the $apply.addEventListener block
old_pattern = r'''      \$apply\.addEventListener\("click", async \(\) => \{
        const sid = getSessionId\(\);
        if \(!sid\) \{ alert\("Aucune session active\. Cliquez sur .Commencer une session.\."'\); return; \}

        await validateAllPending\(\);

        const ok = confirm\("Clôturer l'inventaire \?\\nTous les produits non saisis seront remis à 0\."\);
        if \(!ok\) return;

        \$apply\.disabled = true;
        setBusy\(true, 'Clôture de l'inventaire en cours…'\);'''

new_code = '''      $apply.addEventListener("click", async () => {
        const sid = getSessionId();
        if (!sid) { alert("Aucune session active. Cliquez sur \\"Commencer une session\\"."); return; }

        await validateAllPending();

        // Vérifier les devices actifs sur cette session
        try {
          setBusy(true, 'Vérification des postes actifs...');
          const counts = await window.electronAPI.invoke('inventory:getCounts', sid);
          
          // Grouper par device_id
          const deviceSet = new Set();
          for (const c of counts || []) {
            if (c.device_id) deviceSet.add(c.device_id);
          }
          
          const deviceCount = deviceSet.size;
          setBusy(false);
          
          if (deviceCount > 1) {
            // Plusieurs devices => afficher warning
            const proceed = await showModal({
              title: '⚠️ Plusieurs postes détectés',
              content: `
                <p><strong>${deviceCount} postes</strong> ont participé à cet inventaire :</p>
                <ul style="text-align: left; margin: 10px 0;">
                  ${Array.from(deviceSet).map(d => `<li>${d}</li>`).join('')}
                </ul>
                <p><strong>Important :</strong> En clôturant maintenant, les stocks seront mis à jour avec les comptages de <strong>TOUS les postes</strong> (agrégés).</p>
                <p>Assurez-vous que tous les postes ont terminé leur comptage avant de clôturer.</p>
                <p style="margin-top: 16px;">Voulez-vous continuer et clôturer l'inventaire ?</p>
              `,
              buttons: [
                { label: 'Annuler', value: false },
                { label: 'Clôturer maintenant', value: true }
              ]
            });
            
            if (!proceed) return;
          } else {
            // Un seul device => confirmation simple
            const ok = confirm("Clôturer l'inventaire ?\\n\\nLes stocks seront mis à jour avec les quantités comptées.");
            if (!ok) return;
          }
        } catch (e) {
          setBusy(false);
          console.warn('[inventaire] Impossible de vérifier les devices:', e);
          // Continuer avec confirmation simple
          const ok = confirm("Clôturer l'inventaire ?\\n\\nLes stocks seront mis à jour avec les quantités comptées.");
          if (!ok) return;
        }

        $apply.disabled = true;
        setBusy(true, 'Clôture de l'inventaire en cours…');'''

# Simple string replacement first
content = content.replace(
    '''const ok = confirm("Clôturer l'inventaire ?\\nTous les produits non saisis seront remis à 0.");
        if (!ok) return;

        $apply.disabled = true;
        setBusy(true, 'Clôture de l'inventaire en cours…');''',
    '''// Vérifier les devices actifs sur cette session
        try {
          setBusy(true, 'Vérification des postes actifs...');
          const counts = await window.electronAPI.invoke('inventory:getCounts', sid);
          
          // Grouper par device_id
          const deviceSet = new Set();
          for (const c of counts || []) {
            if (c.device_id) deviceSet.add(c.device_id);
          }
          
          const deviceCount = deviceSet.size;
          setBusy(false);
          
          if (deviceCount > 1) {
            // Plusieurs devices => afficher warning
            const proceed = await showModal({
              title: '⚠️ Plusieurs postes détectés',
              content: `
                <p><strong>${deviceCount} postes</strong> ont participé à cet inventaire :</p>
                <ul style="text-align: left; margin: 10px 0;">
                  ${Array.from(deviceSet).map(d => `<li>${d}</li>`).join('')}
                </ul>
                <p><strong>Important :</strong> En clôturant maintenant, les stocks seront mis à jour avec les comptages de <strong>TOUS les postes</strong> (agrégés).</p>
                <p>Assurez-vous que tous les postes ont terminé leur comptage avant de clôturer.</p>
                <p style="margin-top: 16px;">Voulez-vous continuer et clôturer l'inventaire ?</p>
              `,
              buttons: [
                { label: 'Annuler', value: false },
                { label: 'Clôturer maintenant', value: true }
              ]
            });
            
            if (!proceed) return;
          } else {
            // Un seul device => confirmation simple
            const ok = confirm("Clôturer l'inventaire ?\\n\\nLes stocks seront mis à jour avec les quantités comptées.");
            if (!ok) return;
          }
        } catch (e) {
          setBusy(false);
          console.warn('[inventaire] Impossible de vérifier les devices:', e);
          // Continuer avec confirmation simple
          const ok = confirm("Clôturer l'inventaire ?\\n\\nLes stocks seront mis à jour avec les quantités comptées.");
          if (!ok) return;
        }

        $apply.disabled = true;
        setBusy(true, 'Clôture de l'inventaire en cours…');'''
)

with open(file_path, 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print("File patched successfully!")
