// Nomen vault engine (browser). Each coin's creator fees flow into a Blueshift
// WinterWallet PDA: a permanent address that only a Winternitz one-time
// signature can spend from. Keys come from a 24-word phrase that never leaves
// this browser; every spend rotates the on-chain root to the next key.
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
import {
  PublicKey, Keypair, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, SystemProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as W from './winter.mjs';
import { createInitializeInstruction } from './winterwallet-sdk/instructions/initialize.ts';
import { createWithdrawPlan } from './winterwallet-sdk/plan.ts';
import { WINTERWALLET_PROGRAM_ID } from './winterwallet-sdk/constants.ts';

export { W, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL };
export const PROGRAM_ID = WINTERWALLET_PROGRAM_ID;
const ADVANCE_CU = 800_000;
const PRIORITY = 100_000;

export function pdaFor(id) {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('winterwallet'), id], WINTERWALLET_PROGRAM_ID);
}

/** A brand-new vault: fresh phrase, its wallet id (root of key 0) and permanent address. */
export function createVault() {
  const phrase = W.generatePhrase();
  return describe(phrase);
}

export function describe(phrase) {
  const master = W.masterFromPhrase(phrase);
  const id = W.rootAt(master, { wallet: 0, parent: 0, child: 0 });
  const [pda, bump] = pdaFor(id);
  return { phrase: W.normalizePhrase(phrase), master, id, idHex: W.toHex(id), address: pda.toBase58(), bump };
}

function v0(payer, ixs, blockhash, cuLimit) {
  const pre = [];
  if (cuLimit) pre.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
  pre.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }));
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [...pre, ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  if (tx.serialize().length > 1232) throw new Error('Transaction too large.');
  return tx;
}

/**
 * Initialize the vault on chain: signs the domain tag with key #0 (spending it)
 * and commits key #1's root. Anyone can pay; the signature is the authority.
 */
export function buildInitializeTx({ vault, payer, blockhash }) {
  const payerPk = new PublicKey(payer);
  const parts = [W.INITIALIZE_TAG];
  const sig = W.sign(vault.master, { wallet: 0, parent: 0, child: 0 }, parts);
  if (!W.verify(sig, parts, vault.id)) throw new Error('Local signature check failed.');
  const nextRoot = W.rootAt(vault.master, { wallet: 0, parent: 0, child: 1 });
  const ix = createInitializeInstruction(payerPk, new PublicKey(vault.address), sig, nextRoot);
  return v0(payerPk, [ix], blockhash, ADVANCE_CU);
}

// --------------------------------------------------- one-time-key guard --
// A Winternitz key must sign exactly one message. Remember what each position
// signed; refuse to sign a *different* message there (re-sending the identical
// spend after a dropped transaction is fine).
function guardKey(address, child) { return `nomen.wots.${address}.${child}`; }
function guardCheck(address, child, digestHex) {
  let prev = null;
  try { prev = localStorage.getItem(guardKey(address, child)); } catch {}
  if (prev && prev !== digestHex) {
    const e = new Error('This one-time key already signed a different withdrawal that has not landed yet. Re-send that one, or wait for it to confirm.');
    e.code = 'KEY_REUSE'; e.pending = prev;
    throw e;
  }
}
function guardRecord(address, child, digestHex, spend) {
  try {
    localStorage.setItem(guardKey(address, child), digestHex);
    localStorage.setItem(`nomen.pending.${address}`, JSON.stringify({ child, digestHex, ...spend }));
  } catch {}
}
export function pendingSpend(address) {
  try { return JSON.parse(localStorage.getItem(`nomen.pending.${address}`) || 'null'); } catch { return null; }
}
export function clearPending(address) { try { localStorage.removeItem(`nomen.pending.${address}`); } catch {} }

/**
 * Withdraw `lamports` from the vault to `receiver`.
 * Finds which key matches the on-chain root, signs the Advance preimage with
 * it, commits the next key's root, and returns a v0 transaction for the
 * connected wallet to pay for.
 */
export function buildWithdrawTx({ vault, payer, receiver, lamports, onchainRootHex, blockhash, hint = 1 }) {
  const payerPk = new PublicKey(payer), receiverPk = new PublicKey(receiver);
  const amount = BigInt(lamports);
  if (amount <= 0n) throw new Error('Enter an amount above zero.');
  const currentRoot = W.fromHex(onchainRootHex);
  const pos = W.findPosition(vault.master, currentRoot, { hint });
  if (!pos) throw new Error('This phrase does not control that vault (no key matches the on-chain root).');
  const newRoot = W.rootAt(vault.master, W.nextPos(pos));
  const walletPk = new PublicKey(vault.address);
  const plan = createWithdrawPlan({ walletPda: walletPk, receiver: receiverPk, lamports: amount, newRoot });
  const parts = W.advanceParts(vault.id, currentRoot, newRoot, plan.accountAddresses, plan.payload);
  const digestHex = W.toHex(W.msgHash(parts));
  guardCheck(vault.address, pos.child, digestHex);
  const sig = W.sign(vault.master, pos, parts);
  if (!W.verify(sig, parts, currentRoot)) throw new Error('Local signature check failed.');
  guardRecord(vault.address, pos.child, digestHex, { receiver: receiverPk.toBase58(), lamports: amount.toString() });
  const ix = plan.createInstruction(sig);
  return { tx: v0(payerPk, [ix], blockhash, ADVANCE_CU), position: pos.child, nextPosition: pos.child + 1, digestHex };
}

/** Plain SOL deposit into a vault (anyone can top one up). */
export function buildDepositTx({ payer, vaultAddress, lamports, blockhash }) {
  const payerPk = new PublicKey(payer);
  return v0(payerPk, [SystemProgram.transfer({ fromPubkey: payerPk, toPubkey: new PublicKey(vaultAddress), lamports: BigInt(lamports) })], blockhash);
}

export function txFromBase64(b64) { return VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); }
export function txToBase64(tx) { let s = ''; for (const b of tx.serialize()) s += String.fromCharCode(b); return btoa(s); }
export function newMintKeypair() { return Keypair.generate(); }

/** Visualization helper: the per-chain digits a message would reveal. */
export function digitsFor(text) {
  const h = W.msgHash([new TextEncoder().encode(text)]);
  let sum = 0; const d = [];
  for (let i = 0; i < W.N; i++) { d.push(h[i]); sum += 255 - h[i]; }
  d.push((sum >> 8) & 0xff, sum & 0xff);
  return d;
}
