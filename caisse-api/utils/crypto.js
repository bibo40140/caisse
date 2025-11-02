// utils/crypto.js
import crypto from 'crypto';

const keyHex = process.env.EMAIL_SECRET_KEY;
if (!keyHex || Buffer.from(keyHex, 'hex').length !== 32) {
  throw new Error('EMAIL_SECRET_KEY must be 32 bytes hex');
}
const key = Buffer.from(keyHex, 'hex'); // 32 bytes

// Retourne base64(iv|tag|ciphertext)
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString('utf8');
}
