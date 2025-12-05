# start-poste2.ps1
# Lance une deuxième instance de l'application caisse avec un DEVICE_ID différent

$env:DEVICE_ID = "poste-2"
$env:ELECTRON_USER_DATA = "$PSScriptRoot\data-poste2"

Write-Host "🖥️  Lancement du POSTE 2 avec DEVICE_ID=poste-2" -ForegroundColor Green
Write-Host "📁 Données stockées dans: $env:ELECTRON_USER_DATA" -ForegroundColor Cyan

npm start
