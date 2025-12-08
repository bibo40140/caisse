// Script pour nettoyer les doublons d'adhérents
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Trouver le fichier .db dans le dossier db/
const dbDir = path.join(__dirname, 'db');
const files = fs.readdirSync(dbDir).filter(f => f.startsWith('tenant_') && f.endsWith('.db'));

if (files.length === 0) {
  console.error('❌ Aucun fichier .db trouvé dans db/');
  process.exit(1);
}

const dbFile = path.join(dbDir, files[0]);
console.log(`📂 Utilisation de la base: ${dbFile}`);

const db = new Database(dbFile);

try {
  // Rechercher les doublons (même nom ET prenom)
  const doublons = db.prepare(`
    SELECT nom, prenom, COUNT(*) as count
    FROM adherents
    WHERE nom IS NOT NULL AND prenom IS NOT NULL
    GROUP BY nom, prenom
    HAVING COUNT(*) > 1
  `).all();

  if (doublons.length === 0) {
    console.log('✅ Aucun doublon trouvé');
    process.exit(0);
  }

  console.log(`\n🔍 ${doublons.length} doublons trouvés:\n`);

  for (const doublon of doublons) {
    console.log(`\n➡️  ${doublon.nom} ${doublon.prenom} (${doublon.count} enregistrements)`);
    
    // Récupérer tous les enregistrements pour ce doublon
    const enregistrements = db.prepare(`
      SELECT * FROM adherents
      WHERE nom = ? AND prenom = ?
      ORDER BY id
    `).all(doublon.nom, doublon.prenom);

    // Afficher les enregistrements
    enregistrements.forEach((e, i) => {
      console.log(`   [${i+1}] ID: ${e.id}, Email: ${e.email1 || 'vide'}, Remote UUID: ${e.remote_uuid || 'vide'}, Archive: ${e.archive}`);
    });

    // Déterminer lequel garder :
    // 1. Celui qui a un remote_uuid
    // 2. Sinon celui qui a le plus d'informations
    // 3. Sinon le premier
    
    let aGarder = enregistrements.find(e => e.remote_uuid) || 
                  enregistrements.reduce((a, b) => {
                    const scoreA = (a.email1 ? 1 : 0) + (a.telephone1 ? 1 : 0) + (a.adresse ? 1 : 0);
                    const scoreB = (b.email1 ? 1 : 0) + (b.telephone1 ? 1 : 0) + (b.adresse ? 1 : 0);
                    return scoreA >= scoreB ? a : b;
                  });

    const aSupprimer = enregistrements.filter(e => e.id !== aGarder.id);

    console.log(`   ✅ On garde l'ID: ${aGarder.id}`);
    console.log(`   ❌ On supprime: ${aSupprimer.map(e => e.id).join(', ')}`);

    // Supprimer les doublons
    const tx = db.transaction(() => {
      for (const e of aSupprimer) {
        // Vérifier s'il y a des références
        const countVentes = db.prepare(`SELECT COUNT(*) as count FROM ventes WHERE adherent_id = ?`).get(e.id)?.count || 0;
        const countCotisations = db.prepare(`SELECT COUNT(*) as count FROM cotisations WHERE adherent_id = ?`).get(e.id)?.count || 0;
        
        if (countVentes > 0 || countCotisations > 0) {
          console.log(`   ⚠️  L'ID ${e.id} a des références (${countVentes} ventes, ${countCotisations} cotisations), on met à jour les FK...`);
          if (countVentes > 0) {
            db.prepare(`UPDATE ventes SET adherent_id = ? WHERE adherent_id = ?`).run(aGarder.id, e.id);
          }
          if (countCotisations > 0) {
            db.prepare(`UPDATE cotisations SET adherent_id = ? WHERE adherent_id = ?`).run(aGarder.id, e.id);
          }
        }
        
        db.prepare(`DELETE FROM adherents WHERE id = ?`).run(e.id);
      }

      // Si l'adhérent à garder n'a pas de remote_uuid mais qu'un des doublons en avait un, on le récupère
      if (!aGarder.remote_uuid) {
        const avecUuid = enregistrements.find(e => e.remote_uuid);
        if (avecUuid) {
          console.log(`   🔗 Récupération du remote_uuid: ${avecUuid.remote_uuid}`);
          db.prepare(`UPDATE adherents SET remote_uuid = ? WHERE id = ?`).run(avecUuid.remote_uuid, aGarder.id);
        }
      }
    });

    tx();
    console.log('   ✅ Nettoyage terminé pour ce doublon');
  }

  console.log('\n✅ Nettoyage complet terminé !');

} catch (e) {
  console.error('❌ Erreur:', e);
  process.exit(1);
} finally {
  db.close();
}
