// Winternitz one-time signatures, byte-for-byte compatible with Blueshift's
// winterwallet (core crate, N = 22 message scalars + 2 checksum scalars,
// SHA-256 chains, tagged Merkle root, HMAC-SHA512 hardened derivation from a
// BIP-39 phrase). Verified against the repository's golden fixtures in
// scripts/test-winter.mjs and against the live mainnet program by simulation.
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hmac } from '@noble/hashes/hmac';
import { generateMnemonic as bip39Generate, validateMnemonic as bip39Validate, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export const N = 22;                 // message scalars
export const TOTAL = N + 2;          // + 2 checksum scalars
export const SIGNATURE_LEN = TOTAL * 32; // 768 bytes
const enc = new TextEncoder();
export const INITIALIZE_TAG = enc.encode('WINTERWALLET_INITIALIZE');
export const ADVANCE_TAG = enc.encode('WINTERWALLET_ADVANCE');

export function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Iterate SHA-256 `iters` times. */
export function chain(seed, iters) {
  let cur = seed;
  for (let i = 0; i < iters; i++) cur = sha256(cur);
  return cur;
}

/** First N bytes of SHA-256 over the concatenated message parts. */
export function msgHash(parts) {
  return sha256(concat(parts)).slice(0, N);
}

// ---------------------------------------------------------------- phrases --
export function generatePhrase() { return bip39Generate(wordlist, 256); }
export function validatePhrase(p) { return bip39Validate(normalizePhrase(p), wordlist); }
export function normalizePhrase(p) { return String(p || '').trim().toLowerCase().split(/\s+/).join(' '); }

/** Master key + chain code: HMAC-SHA512("Winternitz seed", bip39_seed). */
export function masterFromPhrase(phrase) {
  const m = normalizePhrase(phrase);
  if (!bip39Validate(m, wordlist)) throw new Error('That recovery phrase is not valid.');
  const seed = mnemonicToSeedSync(m, '');
  const I = hmac(sha512, enc.encode('Winternitz seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function deriveChild(key, chainCode, index) {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0;
  data.set(key, 1);
  new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0, false);
  const I = hmac(sha512, chainCode, data);
  return [I.slice(0, 32), I.slice(32)];
}

/** Private scalars (24 × 32 bytes) at (wallet, parent, child). */
export function derivePrivkey(master, { wallet = 0, parent = 0, child = 0 }) {
  let k = master.key, c = master.chainCode;
  for (const idx of [wallet, parent, child]) [k, c] = deriveChild(k, c, idx);
  const scalars = [];
  for (let i = 0; i < TOTAL; i++) scalars.push(deriveChild(k, c, i)[0]);
  return scalars;
}

export function toPubkey(scalars) { return scalars.map((s) => chain(s, 255)); }

/** Tagged binary Merkle root over the 24 public scalars (matches WinternitzPubkey::merklize). */
export function merklize(pub) {
  const LEAF = Uint8Array.of(0), NODE = Uint8Array.of(1);
  const stack = [], levels = [];
  for (const leaf of pub) {
    let h = sha256(concat([LEAF, leaf]));
    let level = 0;
    while (stack.length && levels[levels.length - 1] === level) {
      const top = stack.pop(); levels.pop();
      h = sha256(concat([NODE, top, h]));
      level++;
    }
    stack.push(h); levels.push(level);
  }
  while (stack.length > 1) {
    let top = stack.pop(); let topLevel = levels.pop();
    const nextLevel = levels[levels.length - 1];
    while (topLevel < nextLevel) { top = sha256(concat([NODE, top, top])); topLevel++; }
    const next = stack.pop(); levels.pop();
    stack.push(sha256(concat([NODE, next, top])));
    levels.push(topLevel + 1);
  }
  return stack[0];
}

export function rootAt(master, pos) { return merklize(toPubkey(derivePrivkey(master, pos))); }

/** Sign message parts with the key at `pos`. ONE-TIME: never sign two different messages at one position. */
export function sign(master, pos, parts) {
  const sk = derivePrivkey(master, pos);
  const h = msgHash(parts);
  const out = new Uint8Array(SIGNATURE_LEN);
  let sum = 0;
  for (let i = 0; i < N; i++) { out.set(chain(sk[i], h[i]), i * 32); sum += 255 - h[i]; }
  out.set(chain(sk[N], (sum >> 8) & 0xff), N * 32);
  out.set(chain(sk[N + 1], sum & 0xff), (N + 1) * 32);
  return out;
}

/** Recover the Merkle root a signature implies for `parts` (what the program does on chain). */
export function recoverRoot(sig, parts) {
  const h = msgHash(parts);
  const pub = [];
  let sum = 0;
  for (let i = 0; i < N; i++) { pub.push(chain(sig.slice(i * 32, i * 32 + 32), 255 - h[i])); sum += 255 - h[i]; }
  pub.push(chain(sig.slice(N * 32, N * 32 + 32), 255 - ((sum >> 8) & 0xff)));
  pub.push(chain(sig.slice((N + 1) * 32), 255 - (sum & 0xff)));
  return merklize(pub);
}

export function verify(sig, parts, root) { return eq(recoverRoot(sig, parts), root); }

/** Position after `pos` (child increments, parent on overflow). */
export function nextPos({ wallet = 0, parent = 0, child = 0 }) {
  return child === 0xffffffff ? { wallet, parent: parent + 1, child: 0 } : { wallet, parent, child: child + 1 };
}

/** The canonical Advance preimage parts. */
export function advanceParts(id, currentRoot, newRoot, accountAddresses, payload) {
  return [ADVANCE_TAG, id, currentRoot, newRoot, ...accountAddresses, payload];
}

/**
 * Find which child index produced the wallet's on-chain root (positions only move forward).
 * Starts from a hint so normal use is O(1).
 */
export function findPosition(master, onchainRoot, { wallet = 0, hint = 1, max = 4096 } = {}) {
  for (let child = Math.max(1, hint); child < max; child++) if (eq(rootAt(master, { wallet, parent: 0, child }), onchainRoot)) return { wallet, parent: 0, child };
  for (let child = 1; child < Math.min(hint, max); child++) if (eq(rootAt(master, { wallet, parent: 0, child }), onchainRoot)) return { wallet, parent: 0, child };
  return null;
}
