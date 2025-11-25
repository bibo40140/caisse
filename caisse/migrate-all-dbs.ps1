# migrate-all-dbs.ps1
# Script PowerShell pour appliquer la migration SQL a toutes les bases tenant

Write-Host "Recherche des bases de donnees..." -ForegroundColor Cyan

$dbFiles = Get-ChildItem -Path "./db" -Filter "*.db" | Where-Object { $_.Name -like "tenant_*.db" }

if ($dbFiles.Count -eq 0) {
    Write-Host "Aucune base de donnees tenant trouvee" -ForegroundColor Red
    exit 1
}

Write-Host "$($dbFiles.Count) base(s) trouvee(s)" -ForegroundColor Green

# Verifier si sqlite3 est disponible
try {
    $null = Get-Command sqlite3 -ErrorAction Stop
    $useSqlite3 = $true
    Write-Host "sqlite3 CLI detecte" -ForegroundColor Green
} catch {
    Write-Host "sqlite3 CLI non trouve" -ForegroundColor Yellow
    $useSqlite3 = $false
}

foreach ($db in $dbFiles) {
    Write-Host "`nMigration de: $($db.Name)" -ForegroundColor Cyan
    
    if ($useSqlite3) {
        # Utiliser sqlite3 CLI
        Get-Content "./migrate-receptions-fk.sql" | sqlite3 $db.FullName
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Migration reussie" -ForegroundColor Green
        } else {
            Write-Host "  Erreur lors de la migration" -ForegroundColor Red
        }
    } else {
        Write-Host "  Migration manuelle necessaire" -ForegroundColor Yellow
        Write-Host "  Executez: sqlite3 ""$($db.FullName)"" < migrate-receptions-fk.sql" -ForegroundColor Gray
    }
}

Write-Host "`nScript termine !" -ForegroundColor Green
Write-Host "REDEMARREZ L'APPLICATION pour que les changements prennent effet" -ForegroundColor Yellow
