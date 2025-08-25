const { ipcMain } = require('electron');
const mpDb = require('../db/modes_paiement');

ipcMain.handle('mp:getAll', () => mpDb.getAll());
ipcMain.handle('mp:getAllAdmin', () => mpDb.getAllAdmin());
ipcMain.handle('mp:create', (e, payload) => mpDb.create(payload));
ipcMain.handle('mp:update', (e, payload) => mpDb.update(payload));
ipcMain.handle('mp:remove', (e, id) => mpDb.remove(id));
