// Throttled: find a fresh pump.fun coin (no fee-sharing config yet) and simulate
// routing 100% of its creator fees into a new WinterWallet vault.
import { createRequire } from 'node:module';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import * as V from './.vault.node.mjs';
const require = createRequire(import.meta.url);
const chain = require('../lib/chain.js');
const conn = chain.connection;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sigs = await conn.getSignaturesForAddress(new PublicKey('TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'), { limit: 25 });
let coin = null;
for (const s of sigs) {
  if (s.err) continue;
  await sleep(700);
  let tx; try { tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); } catch { continue; }
  const logs = tx?.meta?.logMessages || [];
  if (!logs.some((l) => /Instruction: CreateV2|Instruction: Create$/.test(l))) continue;
  const mint = (tx.meta.postTokenBalances || []).find((b) => b.mint)?.mint;
  if (!mint) continue;
  await sleep(500);
  const st = await chain.readCoinFeeState(new PublicKey(mint));
  if (st.bondingCurve && !st.sharingConfig && !st.bondingCurve.complete) { coin = { mint, creator: st.bondingCurve.creator.toBase58() }; break; }
}
if (!coin) { console.log('no fresh coin found in the last 40 pump txs; rerun'); process.exit(2); }
console.log('coin', coin.mint, 'creator', coin.creator);
const vault = V.createVault();
const { tx, size } = await chain.buildRouteTx({ creator: coin.creator, mint: coin.mint, vault: vault.address });
const r = await conn.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(tx, 'base64')), { sigVerify: false, replaceRecentBlockhash: true });
console.log(r.value.err ? 'FAIL' : 'PASS', 'route creator fees -> vault', 'cu=' + r.value.unitsConsumed, 'size=' + size);
if (r.value.err) console.log(JSON.stringify(r.value.err), '\n' + (r.value.logs || []).slice(-12).join('\n'));
else console.log((r.value.logs || []).filter((l) => /Instruction:/.test(l)).join('\n'));
process.exit(r.value.err ? 1 : 0);
