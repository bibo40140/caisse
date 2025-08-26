const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { randomUUID } = require('crypto');

function getDeviceId() {
  const dir = app.getPath('userData');
  const file = path.join(dir, 'device.json');
  try {
    if (fs.existsSync(file)) {
      const { deviceId } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (deviceId) return deviceId;
    }
  } catch (_) {}
  const deviceId = randomUUID();
  try {
    fs.writeFileSync(file, JSON.stringify({ deviceId }, null, 2), 'utf8');
  } catch (_) {}
  return deviceId;
}

module.exports = { getDeviceId };
