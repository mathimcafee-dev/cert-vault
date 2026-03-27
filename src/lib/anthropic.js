export async function generateCsrAndKey({ domain, organization, orgUnit, city, state, country, email, algorithm, keySize }) {
  // Generate using Web Crypto API - completely free, no external API needed
  try {
    let keyPair;
    
    if (algorithm === 'ECDSA') {
      const curve = keySize === 'P-384' ? 'P-384' : 'P-256';
      keyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: curve },
        true,
        ['sign', 'verify']
      );
    } else {
      const bits = parseInt(keySize) || 2048;
      keyPair = await window.crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      );
    }

    // Export private key to PEM
    const privateKeyDer = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${chunkBase64(arrayBufferToBase64(privateKeyDer))}\n-----END PRIVATE KEY-----`;

    // Export public key
    const publicKeyDer = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);

    // Build CSR manually using ASN.1 DER encoding
    const subject = buildSubject({ domain, organization, orgUnit, city, state, country, email });
    const tbsCsr = buildTbsCsr(subject, publicKeyDer);
    
    // Sign the TBS CSR
    let signature;
    if (algorithm === 'ECDSA') {
      signature = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        tbsCsr
      );
    } else {
      signature = await window.crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        keyPair.privateKey,
        tbsCsr
      );
    }

    // Build full CSR
    const csrDer = buildCsr(tbsCsr, signature, algorithm);
    const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${chunkBase64(arrayBufferToBase64(csrDer))}\n-----END CERTIFICATE REQUEST-----`;

    return { csr: csrPem, privateKey: privateKeyPem };

  } catch (err) {
    throw new Error('CSR generation failed: ' + err.message);
  }
}

// ── ASN.1 / DER helpers ────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function chunkBase64(b64) {
  return b64.match(/.{1,64}/g).join('\n');
}

function encodeLength(len) {
  if (len < 128) return [len];
  const hex = len.toString(16).padStart(len > 255 ? 4 : 2, '0');
  const bytes = hex.match(/.{2}/g).map(h => parseInt(h, 16));
  return [0x80 | bytes.length, ...bytes];
}

function encodeSeq(content) {
  const c = typeof content === 'string' ? hexToBytes(content) : content;
  return new Uint8Array([0x30, ...encodeLength(c.length), ...c]);
}

function encodeSet(content) {
  return new Uint8Array([0x31, ...encodeLength(content.length), ...content]);
}

function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const encoded = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    const bytes = [];
    bytes.unshift(val & 0x7f);
    val >>= 7;
    while (val > 0) { bytes.unshift((val & 0x7f) | 0x80); val >>= 7; }
    encoded.push(...bytes);
  }
  return new Uint8Array([0x06, encoded.length, ...encoded]);
}

function encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  return new Uint8Array([0x0c, ...encodeLength(bytes.length), ...bytes]);
}

function encodePrintable(str) {
  const bytes = new TextEncoder().encode(str);
  return new Uint8Array([0x13, ...encodeLength(bytes.length), ...bytes]);
}

function encodeAttr(oid, value) {
  const oidEnc = encodeOid(oid);
  const valEnc = encodeUtf8(value);
  const seq = encodeSeq(concat(oidEnc, valEnc));
  return encodeSet(seq);
}

function encodeCountryAttr(oid, value) {
  const oidEnc = encodeOid(oid);
  const valEnc = encodePrintable(value.slice(0, 2).toUpperCase());
  const seq = encodeSeq(concat(oidEnc, valEnc));
  return encodeSet(seq);
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  return new Uint8Array(bytes);
}

function buildSubject({ domain, organization, orgUnit, city, state, country, email }) {
  const parts = [];
  if (country)      parts.push(encodeCountryAttr('2.5.4.6',  country));
  if (state)        parts.push(encodeAttr('2.5.4.8',  state));
  if (city)         parts.push(encodeAttr('2.5.4.7',  city));
  if (organization) parts.push(encodeAttr('2.5.4.10', organization));
  if (orgUnit)      parts.push(encodeAttr('2.5.4.11', orgUnit));
  if (domain)       parts.push(encodeAttr('2.5.4.3',  domain));
  if (email)        parts.push(encodeAttr('1.2.840.113549.1.9.1', email));
  return encodeSeq(concat(...parts));
}

function buildTbsCsr(subject, publicKeyDer) {
  // version = 0
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  // public key info (already DER encoded from exportKey)
  const pubKeyInfo = new Uint8Array(publicKeyDer);
  // attributes [0] IMPLICIT (empty)
  const attrs = new Uint8Array([0xa0, 0x00]);

  const tbs = concat(version, subject, pubKeyInfo, attrs);
  return encodeSeq(tbs);
}

function buildCsr(tbsCsr, signature, algorithm) {
  // Signature algorithm identifier
  let sigAlgId;
  if (algorithm === 'ECDSA') {
    // ecdsa-with-SHA256
    sigAlgId = encodeSeq(encodeOid('1.2.840.10045.4.3.2'));
  } else {
    // sha256WithRSAEncryption
    const oid = encodeOid('1.2.840.113549.1.1.11');
    const nul = new Uint8Array([0x05, 0x00]);
    sigAlgId = encodeSeq(concat(oid, nul));
  }

  // Signature bit string
  const sigBytes = new Uint8Array(signature);
  const bitString = new Uint8Array([0x03, ...encodeLength(sigBytes.length + 1), 0x00, ...sigBytes]);

  return encodeSeq(concat(tbsCsr, sigAlgId, bitString));
}
