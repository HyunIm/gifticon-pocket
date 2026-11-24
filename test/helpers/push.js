import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { toBase64Url } from '../../worker/webpush.js';

// A browser's side of a subscription, made with node:crypto rather than WebCrypto.
export function browserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, auth,
    subscription: { endpoint, keys: { p256dh: toBase64Url(ecdh.getPublicKey()), auth: toBase64Url(auth) } },
  };
}

// Independent RFC 8291 decryption, as the browser's push service client would do it.
export function decryptPush(body, ecdh, auth) {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const keyLength = data[20];
  const serverPublic = data.subarray(21, 21 + keyLength);
  const ciphertext = data.subarray(21 + keyLength);
  const shared = ecdh.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(data.readUInt32BE(16), 4096, 'record size');
  assert.equal(plain.at(-1), 2, 'last-record delimiter');
  return plain.subarray(0, -1).toString('utf8');
}
