// Full vault lifecycle against the REAL WinterWallet program binary dumped from
// mainnet (scripts/fixtures/winterwallet.so, programdata 82xrjrH8...), executed
// in LiteSVM: initialize -> creator fees land -> withdraw (Winternitz-signed,
// key rotates) -> replay rejected -> second withdraw -> over-withdraw rejected.
// Runs on Linux/macOS (LiteSVM has no Windows build) - see .github/workflows.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { getTransactionDecoder } from '@solana/kit';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as V from './.vault.node.mjs';

const so = readFileSync(new URL('./fixtures/winterwallet.so', import.meta.url));
const EXPECTED = '9c27f60e342f3f9c25b73c82e2c5dd5f7578e2c71dea19cf3c0fa8e7c8625068';
const got = createHash('sha256').update(so).digest('hex');
if (got !== EXPECTED) { console.log('FAIL program binary hash', got); process.exit(1); }

const svm = new LiteSVM();
svm.addProgram(V.PROGRAM_ID.toBase58(), so);
const kit = (tx) => getTransactionDecoder().decode(tx.serialize());
let fails = 0, n = 0;
const check = (cond, label) => { n++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };
function send(tx, signers) {
  tx.sign(signers);
  const r = svm.sendTransaction(kit(tx));
  svm.expireBlockhash();
  return r;
}
const failed = (r) => r instanceof FailedTransactionMetadata;
const acct = (pk) => svm.getAccount(pk.toBase58 ? pk.toBase58() : pk);
const bal = (pk) => Number(svm.getBalance(pk.toBase58 ? pk.toBase58() : pk) ?? 0n);

const payer = Keypair.generate();
svm.airdrop(payer.publicKey.toBase58(), BigInt(20 * LAMPORTS_PER_SOL));
const receiver = Keypair.generate().publicKey;
const vault = V.createVault();
const vaultPk = new PublicKey(vault.address);

// 0. creator fees can land before the vault is initialized (pump pays plain lamports)
{
  const { SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vaultPk, lamports: 0.25 * LAMPORTS_PER_SOL })] }).compileToV0Message();
  const r = send(new VersionedTransaction(msg), [payer]);
  check(!failed(r) && bal(vaultPk) === 0.25 * LAMPORTS_PER_SOL, 'fees can arrive before initialize');
}

// 1. initialize
{
  const r = send(V.buildInitializeTx({ vault, payer: payer.publicKey.toBase58(), blockhash: svm.latestBlockhash() }), [payer]);
  if (failed(r)) console.log(r.toString());
  const a = acct(vaultPk);
  check(!failed(r), `initialize (cu=${failed(r) ? '-' : r.computeUnitsConsumed()})`);
  check(a.exists && a.data.length === 65 && a.programAddress === V.PROGRAM_ID.toBase58(), 'vault account is a 65-byte WinterWallet');
  check(V.W.toHex(a.data.slice(0, 32)) === vault.idHex, 'stored id = root of key #0');
  check(V.W.toHex(a.data.slice(32, 64)) === V.W.toHex(V.W.rootAt(vault.master, { child: 1 })), 'stored root = key #1');
  check(bal(vaultPk) >= 0.25 * LAMPORTS_PER_SOL, 'pre-initialize fees kept');
}

// 2. more creator fees land
{
  const { SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vaultPk, lamports: 2 * LAMPORTS_PER_SOL })] }).compileToV0Message();
  check(!failed(send(new VersionedTransaction(msg), [payer])), 'deposit 2 SOL into initialized vault');
}

const rootHex = () => V.W.toHex(acct(vaultPk).data.slice(32, 64));

// 3. withdraw 0.7 SOL with key #1
let firstTx;
{
  const before = bal(receiver);
  const w = V.buildWithdrawTx({ vault, payer: payer.publicKey.toBase58(), receiver: receiver.toBase58(), lamports: 0.7 * LAMPORTS_PER_SOL, onchainRootHex: rootHex(), blockhash: svm.latestBlockhash() });
  firstTx = w;
  const r = send(w.tx, [payer]);
  if (failed(r)) console.log(r.toString());
  check(!failed(r) && w.position === 1, `withdraw 0.7 SOL signed by key #1 (cu=${failed(r) ? '-' : r.computeUnitsConsumed()})`);
  check(bal(receiver) - before === 0.7 * LAMPORTS_PER_SOL, 'receiver got exactly 0.7 SOL');
  check(rootHex() === V.W.toHex(V.W.rootAt(vault.master, { child: 2 })), 'root rotated to key #2');
}

// 4. replaying the same signed withdrawal must fail (key #1 is retired)
{
  const { VersionedTransaction, TransactionMessage } = await import('@solana/web3.js');
  const ixs = TransactionMessage.decompile(firstTx.tx.message).instructions;
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: ixs }).compileToV0Message();
  const r = send(new VersionedTransaction(msg), [payer]);
  check(failed(r), 'replayed signature rejected after rotation');
}

// 5. a redirected withdrawal (same signature, different receiver) must fail
{
  const { VersionedTransaction, TransactionMessage, TransactionInstruction } = await import('@solana/web3.js');
  const w = V.buildWithdrawTx({ vault, payer: payer.publicKey.toBase58(), receiver: receiver.toBase58(), lamports: 0.1 * LAMPORTS_PER_SOL, onchainRootHex: rootHex(), blockhash: svm.latestBlockhash() });
  const ixs = TransactionMessage.decompile(w.tx.message).instructions;
  const thief = Keypair.generate().publicKey;
  const adv = ixs[ixs.length - 1];
  const keys = adv.keys.map((k) => (k.pubkey.equals(receiver) ? { ...k, pubkey: thief } : k));
  ixs[ixs.length - 1] = new TransactionInstruction({ programId: adv.programId, keys, data: adv.data });
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: ixs }).compileToV0Message();
  const r = send(new VersionedTransaction(msg), [payer]);
  check(failed(r) && bal(thief) === 0, 'redirected receiver rejected (signature binds the destination)');
  // the honest version of that exact spend still goes through (same message, same key #2)
  const r2 = send(V.buildWithdrawTx({ vault, payer: payer.publicKey.toBase58(), receiver: receiver.toBase58(), lamports: 0.1 * LAMPORTS_PER_SOL, onchainRootHex: rootHex(), blockhash: svm.latestBlockhash() }).tx, [payer]);
  check(!failed(r2) && rootHex() === V.W.toHex(V.W.rootAt(vault.master, { child: 3 })), 'honest withdrawal with key #2 lands, root -> key #3');
}

// 6. over-withdraw must fail and leave the vault intact
{
  const avail = bal(vaultPk);
  const r = send(V.buildWithdrawTx({ vault, payer: payer.publicKey.toBase58(), receiver: receiver.toBase58(), lamports: avail, onchainRootHex: rootHex(), blockhash: svm.latestBlockhash() }).tx, [payer]);
  check(failed(r) && bal(vaultPk) === avail, 'withdrawing below rent-exempt is refused');
}

// 7. a different phrase cannot find a key for this vault
{
  const other = V.createVault();
  let threw = false;
  try { V.buildWithdrawTx({ vault: { ...vault, master: other.master }, payer: payer.publicKey.toBase58(), receiver: receiver.toBase58(), lamports: 1000, onchainRootHex: rootHex(), blockhash: svm.latestBlockhash() }); } catch { threw = true; }
  check(threw, 'wrong phrase cannot sign for the vault');
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
