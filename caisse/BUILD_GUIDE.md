# 📦 Guide de Build et Distribution - CoopCaisse

## Vue d'ensemble

Ce guide explique comment créer un installeur Windows pour CoopCaisse et le distribuer via GitHub Releases avec auto-update.

**Architecture**: L'API Node.js est embarquée dans l'application Electron. Un seul installeur contient tout.

## 🔧 Prérequis

### 1. Node.js
- **Version requise**: Node.js 18.x ou 20.x
- Vérifier: `node --version`
- Télécharger: https://nodejs.org/

### 2. Git & GitHub
- Compte GitHub avec accès au repo `bibo40140/caisse`
- Git installé et configuré
- Personal Access Token GitHub (voir étape 3)

### 3. Icône de l'application
- **Emplacement**: `caisse/build/icon.ico`
- Format: ICO (Windows), multi-résolutions (16x16, 32x32, 64x64, 128x128, 256x256)
- Outil recommandé: https://www.icoconverter.com/ ou https://convertio.co/fr/png-ico/

---

## 📥 Installation initiale (une seule fois)

### Étape 1: Installer electron-builder

Dans le dossier `caisse/`:

```powershell
npm install --save-dev electron-builder
```

Cela va télécharger ~100MB de dépendances.

### Étape 2: Vérifier l'icône

```powershell
# Vérifier que l'icône existe
Test-Path caisse/build/icon.ico
```

Si `False`, créez un fichier `icon.ico` de 256x256 pixels minimum et placez-le dans `caisse/build/`.

### Étape 3: Générer un GitHub Token

1. Aller sur https://github.com/settings/tokens/new
2. Nom du token: `CoopCaisse-Release`
3. Cocher les permissions:
   - ✅ `repo` (Full control of private repositories)
4. Cliquer sur "Generate token"
5. **COPIER LE TOKEN** (vous ne pourrez plus le voir après)

### Étape 4: Configurer le token

**Option A - Variable d'environnement temporaire** (pour un seul build):
```powershell
$env:GH_TOKEN = "ghp_votre_token_ici"
```

**Option B - Variable persistante** (recommandé):
```powershell
# PowerShell Admin
[System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'ghp_votre_token_ici', 'User')
```

Puis **redémarrer VS Code** ou le terminal.

---

## 🚀 Créer un build

### Build rapide (sans installeur) - POUR TESTER

```powershell
cd caisse
npm run build:dir
```

- Durée: ~5 minutes
- Résultat: `dist/win-unpacked/CoopCaisse.exe`
- Utilisez ceci pour tester que tout fonctionne

### Build complet (installeur) - POUR DISTRIBUTION

```powershell
cd caisse
npm run release
```

Le script va:
1. Vous demander si vous voulez incrémenter la version (patch/minor/major/non)
2. Mettre à jour `package.json` et `version.json`
3. Lancer le build (10-15 minutes)
4. Générer l'installeur dans `dist/`

**Fichiers générés**:
```
dist/
  ├── CoopCaisse Setup 1.0.0.exe  ← Installeur Windows (à distribuer)
  ├── latest.yml                   ← Métadonnées auto-update
  └── win-unpacked/                ← Version décompressée (optionnel)
```

---

## 📤 Publier une release sur GitHub

### Étape 1: Créer la release

1. Aller sur https://github.com/bibo40140/caisse/releases/new
2. Remplir les champs:
   - **Tag**: `v1.0.0` (doit commencer par `v`)
   - **Title**: `CoopCaisse v1.0.0`
   - **Description**: Copier le changelog depuis `version.json`

### Étape 2: Uploader les fichiers

Glisser-déposer ces 2 fichiers depuis `dist/`:
- ✅ `CoopCaisse Setup 1.0.0.exe`
- ✅ `latest.yml`

**IMPORTANT**: Les deux fichiers sont nécessaires pour l'auto-update.

### Étape 3: Publier

- Cocher "Set as the latest release" ✅
- Si c'est une version de test: cocher "This is a pre-release"
- Cliquer sur **"Publish release"**

---

## 👥 Installation pour les utilisateurs

### Première installation

1. Télécharger `CoopCaisse Setup 1.0.0.exe` depuis GitHub Releases
2. Double-cliquer sur l'installeur
3. Suivre l'assistant d'installation:
   - Choisir le dossier d'installation
   - Créer un raccourci bureau (recommandé)
4. Lancer CoopCaisse depuis le menu démarrer ou le bureau

**Emplacement par défaut**: `C:\Users\<username>\AppData\Local\Programs\coopcaisse\`

### Mises à jour automatiques

L'application vérifie automatiquement les nouvelles versions au démarrage:
- Si une mise à jour est disponible → notification
- Téléchargement en arrière-plan
- Redémarrer pour installer

Les utilisateurs ne doivent **rien faire manuellement** après la première installation.

---

## 🔄 Workflow de versioning

### Semantic Versioning

Format: `MAJOR.MINOR.PATCH`

- **MAJOR** (1.0.0 → 2.0.0): Changements incompatibles
- **MINOR** (1.0.0 → 1.1.0): Nouvelles fonctionnalités compatibles
- **PATCH** (1.0.0 → 1.0.1): Corrections de bugs

### Processus de release

```powershell
# 1. Commit tous les changements
git add .
git commit -m "feat: nouvelle fonctionnalité xyz"
git push

# 2. Créer le build
cd caisse
npm run release
# Choisir: patch (pour bug fixes) ou minor (pour nouvelles features)

# 3. Tester l'installeur localement
.\dist\CoopCaisse Setup 1.0.1.exe

# 4. Si OK, créer la release GitHub
# Voir section "Publier une release sur GitHub"

# 5. Commit les fichiers de version mis à jour
git add package.json version.json
git commit -m "chore: bump version to 1.0.1"
git push
```

---

## 🐛 Dépannage

### Erreur: "electron-builder not found"

```powershell
cd caisse
npm install --save-dev electron-builder
```

### Erreur: "Cannot find module 'better-sqlite3'"

L'API embarquée n'a pas ses dépendances. **Solution**:

```powershell
cd ../caisse-api
npm install --production
```

Puis refaire le build.

### Erreur: "GH_TOKEN is not set"

Vous essayez de publier automatiquement sans token GitHub.

**Solution temporaire** (build local uniquement):
```powershell
# Modifier package.json: retirer la section "publish" de "build"
npm run build
```

### L'API ne démarre pas dans l'app installée

**Vérifications**:

1. Vérifier que `caisse-api/` est bien dans le repo
2. Vérifier `caisse/package.json` → `build.extraResources`:
   ```json
   "extraResources": [
     {
       "from": "../caisse-api",
       "to": "api",
       "filter": ["**/*", "!node_modules/**/*"]
     }
   ]
   ```
3. Installer les dépendances de l'API:
   ```powershell
   cd caisse-api
   npm install --production
   ```

### Icône par défaut dans l'installeur

L'icône n'est pas trouvée. Vérifier:

```powershell
Test-Path caisse/build/icon.ico
```

Si `False`, créer le fichier ICO.

### Build très lent

C'est normal:
- **Premier build**: 10-15 minutes (télécharge Node.js runtime ~80MB)
- **Builds suivants**: 3-5 minutes

Pour accélérer les tests, utiliser `npm run build:dir` (pas d'installeur).

---

## 📊 Taille des fichiers

- **Installeur**: ~150-200 MB
- **App installée**: ~250-300 MB
- **Raison**: Embarque Node.js + Electron + Chrome + votre code + API

C'est normal pour une app Electron. Discord, VS Code, Slack = même taille.

---

## 🔐 Sécurité

### Token GitHub

- ⚠️ **Ne jamais commit le token dans Git**
- ⚠️ **Ne jamais le partager**
- Si compromis: révoquer sur GitHub et en générer un nouveau

### Signature de code (optionnel)

Pour éviter les avertissements Windows SmartScreen, vous pouvez signer l'installeur avec un certificat de signature de code (~200€/an).

Configuration dans `package.json`:
```json
"win": {
  "certificateFile": "path/to/cert.pfx",
  "certificatePassword": "password"
}
```

---

## 🎯 Checklist avant release

- [ ] Tous les changements sont commités
- [ ] Tests manuels passent (vente, réception, stats, etc.)
- [ ] `npm run build:dir` fonctionne et l'app se lance
- [ ] Version incrémentée dans `package.json` et `version.json`
- [ ] Changelog à jour dans `version.json`
- [ ] `icon.ico` existe et est correct
- [ ] `GH_TOKEN` est configuré
- [ ] `caisse-api/node_modules/` installé avec `npm install --production`
- [ ] Build complet créé avec `npm run release`
- [ ] Installeur testé sur une machine Windows propre
- [ ] Release GitHub créée avec `.exe` et `latest.yml`

---

## 📞 Support

En cas de problème:

1. Vérifier les logs de build dans le terminal
2. Consulter ce guide
3. Vérifier https://www.electron.build/configuration/configuration

---

## 🎉 Félicitations !

Vous pouvez maintenant distribuer CoopCaisse à vos utilisateurs via GitHub Releases avec auto-update fonctionnel.

**Prochaine étape**: Tester l'installeur sur une machine Windows vierge pour valider le processus complet.
