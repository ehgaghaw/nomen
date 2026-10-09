// Simulates every transaction the site builds against LIVE mainnet programs
// (sigVerify off, so nothing is signed or spent). Run: node scripts/sim-mainnet.mjs
import { createRequire } from 'node:module';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as V from './.vault.node.mjs';
const require = createRequire(import.meta.url);
const chain = require('../lib/chain.js');
const conn = chain.connection;
const RICH = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'; // large system account used only as a simulated fee payer

let fails = 0;
async function sim(label, tx) {
  const vt = typeof tx === 'string' ? VersionedTransaction.deserialize(Buffer.from(tx, 'base64')) : tx;
  const r = await conn.simulateTransaction(vt, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  const ok = !r.value.err;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  cu=${r.value.unitsConsumed} size=${vt.serialize().length}`);
  if (!ok) console.log('   err', JSON.stringify(r.value.err), '\n   ' + (r.value.logs || []).slice(-8).join('\n   '));
  return r;
}

const bh = await chain.latestBlockhash();

// 1. vault initialize: real Winternitz signature checked by the real program
const vault = V.createVault();
console.log('vault', vault.address);
await sim('initialize vault (WinterWallet, Winternitz sig verified on chain)', V.buildInitializeTx({ vault, payer: RICH, blockhash: bh }));

// 1b. a wrong signature must be rejected
{
  const other = V.createVault();
  const bad = { ...vault, master: other.master }; // sign with a different key but claim this vault's address
  try { V.buildInitializeTx({ vault: bad, payer: RICH, blockhash: bh }); fails++; console.log('FAIL  wrong key was not caught locally'); }
  catch (e) { console.log('PASS  wrong key refused before signing: ' + e.message); }
}

// 2. pump.fun launch (create_v2 + dev buy), mint signature skipped in simulation
const mint = Keypair.generate().publicKey.toBase58();
const launch = await chain.buildLaunchTx({ creator: RICH, mint, name: 'Nomen Test', symbol: 'NTEST', uri: 'https://ipfs.io/ipfs/bafkreiexample', devBuySol: 0.01, blockhash: bh });
await sim('pump.fun create_v2 + 0.01 SOL dev buy', launch.tx);
const launch0 = await chain.buildLaunchTx({ creator: RICH, mint, name: 'Nomen Test', symbol: 'NTEST', uri: 'https://ipfs.io/ipfs/bafkreiexample', devBuySol: 0, blockhash: bh });
await sim('pump.fun create_v2 (no dev buy)', launch0.tx);

// 3. route an existing, recent pump coin's fees to a vault (creator signs in sim)
async function findRecentCoin() {
  const sigs = await conn.getSignaturesForAddress(chain.PUMP_PROGRAM, { limit: 60 });
  for (const s of sigs) {
    if (s.err) continue;
    let tx; try { tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); } catch { continue; }
    const logs = tx?.meta?.logMessages || [];
    if (!logs.some((l) => /Instruction: CreateV2|Instruction: Create\b/.test(l))) continue;
    const mintAcc = (tx.meta.postTokenBalances || []).find((b) => b.mint)?.mint;
    if (!mintAcc) continue;
    const st = await chain.readCoinFeeState(new PublicKey(mintAcc));
    if (st.bondingCurve && !st.sharingConfig && !st.bondingCurve.complete) return { mint: mintAcc, creator: st.bondingCurve.creator.toBase58() };
  }
  return null;
}
const coin = await findRecentCoin();
if (coin) {
  console.log('recent coin', coin.mint, 'creator', coin.creator);
  const route = await chain.buildRouteTx({ creator: coin.creator, mint: coin.mint, vault: vault.address });
  await sim('route 100% creator fees -> vault (create_fee_sharing_config + update_fee_shares)', route.tx);
} else { console.log('SKIP  no fresh coin found for routing test'); }

// 4. distribute fees for a coin that already has a sharing config with fees waiting
async function findDistributable() {
  const sigs = await conn.getSignaturesForAddress(chain.PUMP_FEE_PROGRAM, { limit: 80 });
  const seen = new Set();
  for (const s of sigs) {
    if (s.err) continue;
    let tx; try { tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); } catch { continue; }
    for (const b of tx?.meta?.postTokenBalances || []) {
      if (!b.mint || seen.has(b.mint)) continue; seen.add(b.mint);
      try {
        const st = await chain.vaultState({ mint: b.mint, vault: RICH });
        if (st.feeRoute && st.pendingLamports > 2_000_000) return b.mint;
      } catch {}
    }
    const keys = tx?.transaction?.message?.staticAccountKeys || [];
    for (const k of keys) {
      const m = k.toBase58(); if (seen.has(m)) continue; seen.add(m);
      try { const st = await chain.vaultState({ mint: m, vault: RICH }); if (st.feeRoute && st.pendingLamports > 2_000_000) return m; } catch {}
    }
  }
  return null;
}
const dm = await findDistributable();
if (dm) { console.log('distributable coin', dm); await sim('distribute creator fees (permissionless)', (await chain.buildDistributeTx({ payer: RICH, mint: dm })).tx); }
else console.log('SKIP  no coin with pending shared fees found');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
