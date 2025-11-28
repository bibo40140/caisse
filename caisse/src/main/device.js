const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { randomUUID } = require('crypto');

function getDeviceId() {
  // PRIORITÉ 1 : Variable d'environnement (pour multi-instance sur même PC)
  if (process.env.DEVICE_ID) {
    return process.env.DEVICE_ID;
  }
  
  // PRIORITÉ 2 : Fichier device.json dans userData
  const dir = app.getPath('userData');
  const file = path.join(dir, 'device.json');
  try {
    if (fs.existsSync(file)) {
      const { deviceId } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (deviceId) return deviceId;
    }
  } catch (_) {}
  
  // PRIORITÉ 3 : Générer nouveau UUID
  const deviceId = randomUUID();
  try {
    fs.writeFileSync(file, JSON.stringify({ deviceId }, null, 2), 'utf8');
  } catch (_) {}
  return deviceId;
}

module.exports = { getDeviceId };
