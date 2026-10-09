// Cross-checks client-src/winter.js against Blueshift's golden winterwallet fixtures.
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';
import * as W from '../client-src/winter.mjs';

const PROGRAM = new PublicKey('winter5vMwvf51xrSVPTxbAAD6qiSTmPeRTSizMCQCa');
const cases = [
  ['signing-session.json', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
  ['signing-session-alt1.json', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
];
let fails = 0, checks = 0;
const ok = (cond, label) => { checks++; if (!cond) { fails++; console.log('FAIL', label); } };
for (const [file, phrase] of cases) {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/' + file, import.meta.url)));
  const master = W.masterFromPhrase(phrase);
  const id = W.rootAt(master, { wallet: 0, parent: 0, child: 0 });
  ok(W.toHex(id) === fx.wallet_id, file + ' wallet id');
  const [pda, bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode('winterwallet'), id], PROGRAM);
  ok(pda.toBase58() === fx.wallet_pda && bump === fx.wallet_bump, file + ' wallet pda');
  for (const s of fx.sessions) {
    const pos = { wallet: 0, parent: 0, child: s.position };
    const cur = W.rootAt(master, pos);
    const nxt = W.rootAt(master, W.nextPos(pos));
    ok(W.toHex(cur) === s.current_root, `${file} s${s.position} current root`);
    ok(W.toHex(nxt) === s.new_root, `${file} s${s.position} new root`);
    let parts;
    if (s.position === 0) parts = [W.INITIALIZE_TAG];
    else {
      const accts = s.passthrough_accounts.map((a) => new PublicKey(a.pubkey).toBytes());
      parts = W.advanceParts(id, cur, nxt, accts, W.fromHex(s.payload));
    }
    ok(W.toHex(sha256(W.concat(parts))) === s.digest, `${file} s${s.position} digest`);
    const sig = W.sign(master, pos, parts);
    ok(W.toHex(sig) === s.signature, `${file} s${s.position} signature`);
    ok(W.verify(sig, parts, cur), `${file} s${s.position} self-verify`);
    const tampered = parts.slice(); tampered[tampered.length - 1] = W.concat([tampered[tampered.length - 1], Uint8Array.of(1)]);
    ok(!W.verify(sig, tampered, cur), `${file} s${s.position} rejects tampered message`);
  }
}
const p = W.generatePhrase();
ok(p.split(' ').length === 24 && W.validatePhrase(p), 'fresh 24-word phrase');
ok(W.findPosition(W.masterFromPhrase(p), W.rootAt(W.masterFromPhrase(p), { child: 5 }))?.child === 5, 'findPosition');
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
