# 🚀 ACTIONS IMMÉDIATES - CoopCaisse Build

## ✅ CE QUI EST FAIT

1. ✅ `package.json` configuré avec electron-builder
2. ✅ `version.json` créé avec changelog v1.0.0
3. ✅ `scripts/release.js` créé pour automation
4. ✅ `main.js` modifié pour lancer l'API automatiquement
5. ✅ `build/icon.ico` existe
6. ✅ Configuration GitHub Releases (repo: bibo40140/caisse)

## 🎯 CE QUE VOUS DEVEZ FAIRE MAINTENANT

### Étape 1: Installer electron-builder (5 minutes)

```powershell
cd c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse
npm install --save-dev electron-builder
```

### Étape 2: Installer les dépendances de l'API (2 minutes)

```powershell
cd c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse-api
npm install --production
```

### Étape 3: Créer un GitHub Token (2 minutes)

1. Aller sur: https://github.com/settings/tokens/new
2. Nom: `CoopCaisse-Release`
3. Cocher: ✅ `repo` (Full control)
4. Cliquer "Generate token"
5. **COPIER LE TOKEN** immédiatement

### Étape 4: Configurer le token

**Méthode recommandée** (persistant):
```powershell
# Ouvrir PowerShell en Admin
[System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'ghp_VOTRE_TOKEN_ICI', 'User')
```

**Ou méthode rapide** (temporaire):
```powershell
$env:GH_TOKEN = "ghp_VOTRE_TOKEN_ICI"
```

### Étape 5: Créer votre premier build de test (5 minutes)

```powershell
cd c:\Users\fabien.hicauber\Documents\GitHub\Caisse_20251113\caisse\caisse
npm run build:dir
```

Ceci va créer l'app SANS installeur dans `dist/win-unpacked/CoopCaisse.exe` pour tester rapidement.

### Étape 6: Si le test fonctionne, créer l'installeur complet (10-15 minutes)

```powershell
npm run release
```

Quand le script demande la version:
- Tapez `non` (pour garder 1.0.0)
- Ou `patch` pour passer à 1.0.1

Résultat: `dist/CoopCaisse Setup 1.0.0.exe`

### Étape 7: Tester l'installeur

1. Double-cliquer sur `dist/CoopCaisse Setup 1.0.0.exe`
2. Installer l'application
3. Lancer et vérifier:
   - ✅ L'app se lance
   - ✅ L'API démarre automatiquement
   - ✅ Vous pouvez vous connecter
   - ✅ Les fonctionnalités marchent (vente, stats, etc.)

### Étape 8: Publier sur GitHub Releases

1. Aller sur: https://github.com/bibo40140/caisse/releases/new
2. Tag: `v1.0.0`
3. Title: `CoopCaisse v1.0.0`
4. Description: Copier le changelog depuis `version.json`
5. Uploader ces 2 fichiers:
   - `CoopCaisse Setup 1.0.0.exe`
   - `latest.yml`
6. Cliquer "Publish release"

### Étape 9: Tester l'auto-update

1. Sur une autre machine (ou après désinstallation), installer depuis GitHub
2. Créer une nouvelle version (1.0.1) avec `npm run release` (choisir `patch`)
3. Publier la v1.0.1 sur GitHub
4. Lancer l'app v1.0.0 → elle devrait notifier qu'une mise à jour est disponible

## 📖 Documentation complète

Tout est détaillé dans `BUILD_GUIDE.md` avec troubleshooting.

## ⚠️ IMPORTANT

1. **Ne jamais commit le GH_TOKEN dans Git**
2. **Toujours tester l'installeur avant de publier**
3. **Les deux fichiers (.exe ET latest.yml) sont nécessaires pour l'auto-update**

## 🐛 Si ça ne marche pas

**Erreur lors du build?**
- Vérifier que `electron-builder` est installé
- Vérifier que `caisse-api/node_modules` existe

**L'API ne démarre pas dans l'app installée?**
- Vérifier que `caisse-api/` est bien dans le dossier parent de `caisse/`
- Faire `npm install --production` dans `caisse-api/`

**Auto-update ne marche pas?**
- Vérifier que `latest.yml` est uploadé sur GitHub
- Vérifier que la release est marquée comme "latest"

## 📞 Prochaines étapes après la v1.0.0

1. Commit les changements:
```powershell
git add .
git commit -m "chore: setup build system for v1.0.0"
git push
```

2. Pour les prochaines versions:
```powershell
# Faire vos modifications
git add .
git commit -m "feat: nouvelle fonctionnalité"
git push

# Build
npm run release  # Choisir patch/minor/major

# Tester, puis publier sur GitHub
```

## 🎉 Félicitations!

Vous avez maintenant un système de build professionnel avec:
- ✅ Installeur Windows one-click
- ✅ API embarquée (tout-en-un)
- ✅ Auto-update via GitHub
- ✅ Versioning automatique

Bon build! 🚀
