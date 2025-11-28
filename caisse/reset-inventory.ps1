# Script de réinitialisation complète de l'inventaire
# Ce script :
# 1. Ferme toutes les sessions
# 2. Nettoie les données corrompues  
# 3. Réinitialise les stocks à des valeurs connues
# 4. Redémarre proprement

Write-Host "🔧 RÉINITIALISATION COMPLÈTE DE L'INVENTAIRE" -ForegroundColor Cyan
Write-Host ""

# Étape 1 : Arrêter Electron si en cours
Write-Host "1️⃣ Arrêt des processus Electron..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -like "*electron*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "   ✅ Processus arrêtés" -ForegroundColor Green

# Étape 2 : Nettoyer les bases locales
Write-Host ""
Write-Host "2️⃣ Nettoyage des bases de données locales..." -ForegroundColor Yellow
Remove-Item "C:\temp\caisse-A\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "C:\temp\caisse-B\*" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "   ✅ Bases locales supprimées" -ForegroundColor Green

# Étape 3 : Nettoyer Neon via l'API
Write-Host ""
Write-Host "3 Nettoyage de la base Neon PostgreSQL..." -ForegroundColor Yellow

Write-Host "   Allez sur https://console.neon.tech et executez :" -ForegroundColor Yellow
Write-Host ""
Write-Host "   UPDATE inventory_sessions SET status = 'closed', ended_at = NOW() WHERE status = 'open';" -ForegroundColor White
Write-Host "   DELETE FROM inventory_counts;" -ForegroundColor White
Write-Host "   DELETE FROM inventory_summary;" -ForegroundColor White
Write-Host "   UPDATE produits SET stock = 100 WHERE nom LIKE '%test 02%';" -ForegroundColor White
Write-Host "   UPDATE produits SET stock = 50 WHERE nom LIKE '%test biere%';" -ForegroundColor White
Write-Host "   UPDATE produits SET stock = 25 WHERE nom LIKE '%test promme%';" -ForegroundColor White
Write-Host ""

$response = Read-Host "   Avez-vous execute ces commandes SQL sur Neon? (o/n)"

if ($response -ne "o") {
    Write-Host ""
    Write-Host "Veuillez d'abord nettoyer la base Neon avant de continuer." -ForegroundColor Red
    Write-Host ""
    Write-Host "ETAPES MANUELLES :" -ForegroundColor Cyan
    Write-Host "1. Ouvrez https://console.neon.tech" -ForegroundColor White
    Write-Host "2. Selectionnez votre projet" -ForegroundColor White
    Write-Host "3. Allez dans SQL Editor" -ForegroundColor White
    Write-Host "4. Copiez-collez les commandes SQL ci-dessus" -ForegroundColor White
    Write-Host "5. Cliquez sur Run" -ForegroundColor White
    Write-Host "6. Relancez ce script" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "   Base Neon nettoyee" -ForegroundColor Green

Write-Host ""
Write-Host "4 Verification du code corrige..." -ForegroundColor Yellow

# Verifier que le fichier inventory.js contient le nouveau code
$inventoryJsPath = "c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse\src\main\handlers\inventory.js"

if (Test-Path $inventoryJsPath) {
    $content = Get-Content $inventoryJsPath -Raw
    
    if ($content -match "stockBeforeInventory") {
        Write-Host "   Code corrige detecte dans inventory.js" -ForegroundColor Green
    } else {
        Write-Host "   ATTENTION: Le code corrige n'est PAS present !" -ForegroundColor Red
        Write-Host "   Le fichier inventory.js ne contient pas stockBeforeInventory" -ForegroundColor Red
        Write-Host "   Les corrections n'ont pas ete appliquees correctement." -ForegroundColor Red
        Write-Host ""
        $continue = Read-Host "   Continuer quand meme? (o/n)"
        if ($continue -ne "o") {
            exit 1
        }
    }
} else {
    Write-Host "   Fichier inventory.js introuvable" -ForegroundColor Red
}

Write-Host ""
Write-Host "REINITIALISATION TERMINEE !" -ForegroundColor Green
Write-Host ""
Write-Host "PROCHAINES ETAPES :" -ForegroundColor Cyan
Write-Host ""
Write-Host "Terminal 1 (Terminal-A) :" -ForegroundColor Yellow
Write-Host '  cd "c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse"' -ForegroundColor White
Write-Host '  $env:DATA_DIR="C:\temp\caisse-A"; $env:DEVICE_ID="Terminal-A"; npm start' -ForegroundColor White
Write-Host ""
Write-Host "Terminal 2 (Terminal-B) :" -ForegroundColor Yellow
Write-Host '  cd "c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse"' -ForegroundColor White
Write-Host '  $env:DATA_DIR="C:\temp\caisse-B"; $env:DEVICE_ID="Terminal-B"; npm start' -ForegroundColor White
Write-Host ""
Write-Host "TEST A FAIRE :" -ForegroundColor Cyan
Write-Host "1. Terminal-A: Stocks initiaux devraient etre 100, 50, 25" -ForegroundColor White
Write-Host "2. Terminal-B: MEMES stocks initiaux 100, 50, 25" -ForegroundColor White
Write-Host "3. Terminal-A: Commencer session Test-Final" -ForegroundColor White
Write-Host "4. Terminal-A: Compter test 02 = 10 unites puis Valider" -ForegroundColor White
Write-Host "5. Terminal-B: Devrait voir message vert Session Test-Final en cours" -ForegroundColor White
Write-Host "6. Terminal-B: Compter test biere = 5 unites puis Valider" -ForegroundColor White
Write-Host "7. Terminal-A: Voir ecart pour test biere changer" -ForegroundColor White
Write-Host "8. Terminal-A ou B: Cloturer l'inventaire" -ForegroundColor White
Write-Host "9. Page Produits: Stocks = 10, 5, 25 (EXACTEMENT)" -ForegroundColor White
Write-Host ""
Write-Host "Si les stocks finaux sont corrects, le probleme est RESOLU !" -ForegroundColor Green
Write-Host ""
