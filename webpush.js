// Web Push without any packages: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291), Node's crypto only.
const crypto = require('crypto');
const https = require('https');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s || ''), 'base64url');

// A new signing key pair for this site. Stored once; the public key goes to the browser when it subscribes.
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return { publicKey: b64u(raw), privateKey: privateKey.export({ format: 'jwk' }).d, x: jwk.x, y: jwk.y };
}

function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: keys.x, y: keys.y, d: keys.privateKey }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// Encrypts a payload for one subscription (its p256dh public key and auth secret).
function encrypt(subscription, payload) {
  const clientPub = fromB64u(subscription.keys.p256dh), auth = fromB64u(subscription.keys.auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const localPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(clientPub);
  const salt = crypto.randomBytes(16);
  const prk = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, localPub]), 32);
  const cek = hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);   // 0x02 = last record
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([localPub.length]), localPub, body]);
}

// Sends one push. Resolves { ok, status, gone } where gone = the subscription is dead and should be dropped.
function sendPush(subscription, payload, keys, { subject = 'mailto:admin@example.com', ttl = 86400, urgency = 'high' } = {}) {
  return new Promise(resolve => {
    let body;
    try { body = encrypt(subscription, JSON.stringify(payload)); } catch (err) { return resolve({ ok: false, status: 0, error: err.message }); }
    const u = new URL(subscription.endpoint);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: {
      'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
      TTL: ttl, Urgency: urgency, Authorization: vapidHeader(subscription.endpoint, keys, subject) } }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, gone: res.statusCode === 404 || res.statusCode === 410, error: text.slice(0, 200) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', err => resolve({ ok: false, status: 0, error: err.message }));
    req.end(body);
  });
}

module.exports = { generateVapidKeys, sendPush, encrypt, vapidHeader };
