/**
 * Sealing for the email-connection secret (app password) before it is stored
 * in `watches`. AES-256-GCM with a key derived from the deployment env var
 * `DEEBO_SECRET_KEY`.
 *
 * This is the "encrypted at rest" half of the watches table. It is written but
 * NOT yet exercised — there is no Convex deployment to run it on. Treat it as
 * unverified until `watches.saveWatch` has run once against a real deployment.
 *
 * Uses the Web Crypto API (`crypto.subtle`), available in Convex's default
 * function runtime — no Node-only imports, so this can stay inside a mutation.
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export interface SealedSecret {
  secretCiphertext: string; // base64
  secretIv: string; // base64, 12 bytes
}

function envKey(): string {
  const key = process.env.DEEBO_SECRET_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "DEEBO_SECRET_KEY is not set (min 16 chars). Set it with: npx convex env set DEEBO_SECRET_KEY <value>",
    );
  }
  return key;
}

async function importKey(): Promise<CryptoKey> {
  // SHA-256 the configured secret so any passphrase length yields a 256-bit key.
  const digest = await crypto.subtle.digest("SHA-256", ENCODER.encode(envKey()));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Note the explicit `<ArrayBuffer>`: Web Crypto's `BufferSource` rejects the
// wider `Uint8Array<ArrayBufferLike>` that a bare annotation would give us.
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sealSecret(plaintext: string): Promise<SealedSecret> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    ENCODER.encode(plaintext),
  );
  return {
    secretCiphertext: toBase64(new Uint8Array(cipher)),
    secretIv: toBase64(iv),
  };
}

export async function openSecret(sealed: SealedSecret): Promise<string> {
  const key = await importKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.secretIv) },
    key,
    fromBase64(sealed.secretCiphertext),
  );
  return DECODER.decode(plain);
}
