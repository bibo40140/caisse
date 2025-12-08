@echo off
echo ===================================
echo Nettoyage des bases de donnees de test
echo ===================================
echo.

cd /d "%~dp0"

echo Suppression des fichiers .db dans db/...
del /Q db\*.db 2>nul
del /Q db\*.db-* 2>nul

echo.
echo Nettoyage du localStorage...
del /Q "AppData\Local\coopcaisse\*" 2>nul

echo.
echo ===================================
echo Nettoyage termine !
echo ===================================
echo.
echo Prochaines etapes :
echo 1. Relancez l'application
echo 2. Connectez-vous avec votre compte
echo 3. Les bases seront recreees automatiquement avec le nouveau schema
echo.
pause
