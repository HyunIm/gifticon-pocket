import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload, vapidAuthorization, generateVapidKeys, fromBase64Url, toBase64Url } from '../worker/webpush.js';
import { browserSubscription, decryptPush } from './helpers/push.js';

test('payload decrypts with the browser keys', async () => {
  const { ecdh, auth, subscription } = browserSubscription();
  const message = JSON.stringify({ title: '오늘 만료되는 기프티콘 1개', body: '스타벅스 아메리카노' });
  const body = await encryptPayload(subscription, message);
  assert.equal(decryptPush(body, ecdh, auth), message);
});

test('matches the RFC 8291 example', async () => {
  const asPublic = fromBase64Url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: toBase64Url(asPublic.slice(1, 33)), y: toBase64Url(asPublic.slice(33)) };
  const serverKeys = {
    privateKey: await crypto.webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    publicKey: await crypto.webcrypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
  const subscription = { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
  const body = await encryptPayload(subscription, 'When I grow up, I want to be a watermelon', { salt: fromBase64Url('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys });
  assert.equal(toBase64Url(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('VAPID token is a valid ES256 JWT for the push service origin', async () => {
  const vapid = await generateVapidKeys();
  const now = Date.UTC(2026, 10, 24);
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 'https://gifticon.example', now);
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(key, vapid.publicKey);
  const [h, c, s] = token.split('.');
  const claims = JSON.parse(Buffer.from(fromBase64Url(c)).toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 43200, sub: 'https://gifticon.example' });
  const point = fromBase64Url(vapid.publicKey);
  const publicKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33)) } });
  const valid = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromBase64Url(s));
  assert.ok(valid);
});
