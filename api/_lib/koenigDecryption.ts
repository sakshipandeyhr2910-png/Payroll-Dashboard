import * as crypto from 'crypto';

// Ported unchanged from vite-plugins/koenigDecryption.ts — pure crypto, no server-process
// statefulness to worry about, so no behavior change needed for the serverless environment.
//
// Shared by every Koenig Kites API found to encrypt a numeric field this way — confirmed live on
// both GetLastTwoAppraisals' Salary and GetAppraisalData's Amount (same password/salt/algorithm
// for both, provided out-of-band as "Decryption Info.txt"). Legacy .NET
// PasswordDeriveBytes(password, salt) key derivation (SHA1-based, 100 total hash iterations),
// AES-256-CBC, PKCS7 padding, plaintext is UTF-16LE.
function sha1(buf: Buffer): Buffer {
  return crypto.createHash('sha1').update(buf).digest();
}

interface KeyIv {
  key: Buffer;
  iv: Buffer;
}

const keyIvCache = new Map<string, KeyIv>();

function getKeyIv(password: string, salt: string): KeyIv {
  const cacheKey = `${password} ${salt}`;
  const cached = keyIvCache.get(cacheKey);
  if (cached) return cached;
  const h0 = Buffer.concat([Buffer.from(password, 'utf8'), Buffer.from(salt, 'ascii')]);
  let b = sha1(h0);
  // 1 initial hash + 98 more = 99 SHA1 operations total, per the provided derivation steps.
  for (let i = 0; i < 98; i++) {
    b = sha1(b);
  }
  const baseValue = b;
  const block1 = sha1(baseValue);
  const block2 = sha1(Buffer.concat([Buffer.from([0x31]), baseValue]));
  const block3 = sha1(Buffer.concat([Buffer.from([0x32]), baseValue]));
  const key = Buffer.concat([block1, block2.subarray(0, 12)]); // 32 bytes
  const iv = Buffer.concat([block1.subarray(8, 16), block3.subarray(0, 8)]); // 16 bytes
  const result = { key, iv };
  keyIvCache.set(cacheKey, result);
  return result;
}

export function decryptKoenigValue(cipherB64: string | null, password: string, salt: string): number | null {
  if (!cipherB64) return null;
  try {
    const { key, iv } = getKeyIv(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(true);
    const dec = Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]);
    const str = dec.toString('utf16le').trim();
    const n = Number(str);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

// Verified against the known test vector ("rW1mbGfBg+xeDgp3CZ3UBg==" -> "122980") wherever this
// is used — fails loudly rather than silently producing wrong salary figures if the algorithm or
// env constants ever drift.
//
// Unlike the original (which let this throw at Vite plugin setup time, killing the whole dev
// server on a bad .env), callers here MUST wrap this in try/catch and log via console.error
// instead of letting it throw — throwing at module load in a Vercel function would fail a cold
// start for every request to that function, including ones that don't even touch decryption
// (e.g. an unrelated import chain pulling this module in transitively).
export function verifyKoenigDecryption(password: string, salt: string): void {
  const result = decryptKoenigValue('rW1mbGfBg+xeDgp3CZ3UBg==', password, salt);
  if (result !== 122980) {
    throw new Error(`Koenig value decryption self-test failed: expected 122980, got ${result}`);
  }
}

// Safe wrapper every api/**/*.ts handler should call instead of verifyKoenigDecryption directly —
// logs and swallows a self-test failure rather than throwing, per the note above.
export function safeVerifyKoenigDecryption(password: string, salt: string): void {
  try {
    verifyKoenigDecryption(password, salt);
  } catch (err) {
    console.error('[koenigDecryption] self-test failed', err);
  }
}
