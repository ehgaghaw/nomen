// On-chain plumbing: pump.fun launch, creator-fee routing into a coin's
// WinterWallet vault, permissionless fee distribution, live vault state.
// Every builder returns an UNSIGNED v0 transaction (base64); the user's wallet
// signs in the browser. The server never holds user keys.
const {
  Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const BN = require('bn.js');
const pump = require('@pump-fun/pump-sdk');

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
const online = new pump.OnlinePumpSdk(connection);
const PUMP_SDK = pump.PUMP_SDK;

const WINTER_PROGRAM = new PublicKey('winter5vMwvf51xrSVPTxbAAD6qiSTmPeRTSizMCQCa');
const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const WALLET_ACCOUNT_LEN = 65;
const PRIORITY_MICROLAMPORTS = Number(process.env.PRIORITY_MICROLAMPORTS || 100_000);

const pk = (s, label = 'address') => {
  try { return new PublicKey(s); } catch { throw new Error(`Invalid ${label}.`); }
};

function walletPda(id) {
  return PublicKey.findProgramAddressSync([Buffer.from('winterwallet'), Buffer.from(id)], WINTER_PROGRAM);
}

async function toTx(payer, ixs, { cuLimit, cuPrice = PRIORITY_MICROLAMPORTS, blockhash } = {}) {
  const pre = [];
  if (cuLimit) pre.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
  if (cuPrice) pre.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));
  const bh = blockhash || (await connection.getLatestBlockhash('confirmed')).blockhash;
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: bh, instructions: [...pre, ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const bytes = tx.serialize();
  if (bytes.length > 1232) throw new Error(`Transaction too large (${bytes.length} bytes).`);
  return { tx: Buffer.from(bytes).toString('base64'), blockhash: bh, size: bytes.length };
}

// ------------------------------------------------------------------ launch --
let globalCache = { at: 0, global: null, feeConfig: null };
async function pumpGlobals() {
  if (Date.now() - globalCache.at < 60_000 && globalCache.global) return globalCache;
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  globalCache = { at: Date.now(), global, feeConfig };
  return globalCache;
}

/** create_v2 (+ optional dev buy) with `creator` as payer and creator; mint signs client-side. */
async function buildLaunchTx({ creator, mint, name, symbol, uri, devBuySol = 0, blockhash }) {
  const creatorPk = pk(creator, 'wallet'), mintPk = pk(mint, 'mint');
  const { global, feeConfig } = await pumpGlobals();
  let ixs;
  const lamports = Math.round(Number(devBuySol || 0) * LAMPORTS_PER_SOL);
  if (lamports > 0) {
    const solAmount = new BN(lamports);
    const amount = pump.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT });
    ixs = await PUMP_SDK.createV2AndBuyInstructions({
      global, mint: mintPk, name, symbol, uri, creator: creatorPk, user: creatorPk, amount, solAmount, mayhemMode: false,
    });
  } else {
    ixs = [await PUMP_SDK.createV2Instruction({ mint: mintPk, name, symbol, uri, creator: creatorPk, user: creatorPk, mayhemMode: false })];
  }
  return toTx(creatorPk, ixs, { cuLimit: 400_000, blockhash });
}

// ----------------------------------------------------------- fee routing --
/**
 * Point 100% of the coin's creator fees at the vault, permanently:
 * create_fee_sharing_config + update_fee_shares([vault, 10000 bps]).
 * pump.fun revokes the admin on update, so the route can never be changed.
 * `fresh` = the coin is being created in the same signing session (no state to read yet).
 */
async function buildRouteTx({ creator, mint, vault, fresh = false, blockhash }) {
  const creatorPk = pk(creator, 'wallet'), mintPk = pk(mint, 'mint'), vaultPk = pk(vault, 'vault');
  const ixs = [];
  let current = [creatorPk];
  let bondingCurveComplete = false;
  let pool = null;
  if (!fresh) {
    const st = await readCoinFeeState(mintPk);
    if (!st.bondingCurve) throw new Error('That is not a pump.fun coin.');
    if (st.sharingConfig) {
      const sc = st.sharingConfig;
      if (sc.shareholders.length === 1 && sc.shareholders[0].address.equals(vaultPk)) throw new Error('Fees already flow into this vault.');
      if (!pump.isSharingConfigEditable({ sharingConfig: sc }) || sc.adminRevoked) throw new Error('This coin\'s fee split is already locked on pump.fun and cannot be pointed at a vault.');
      if (!sc.admin.equals(creatorPk)) throw new Error('Only the coin\'s fee admin can route its fees.');
      current = sc.shareholders.map((s) => s.address);
    } else if (!st.bondingCurve.creator.equals(creatorPk)) {
      throw new Error('Connect the wallet that created this coin on pump.fun.');
    }
    bondingCurveComplete = !!st.bondingCurve.complete;
    pool = bondingCurveComplete ? pump.canonicalPumpPoolPda(mintPk) : null;
    if (st.bondingCurve.creatorFee && !st.bondingCurve.creatorFee.isZero()) {
      ixs.push(await PUMP_SDK.sweepCreatorFeeInstruction({ payer: creatorPk, mint: mintPk, creator: st.bondingCurve.creator, quoteMint: NATIVE_MINT }));
    }
    if (!st.sharingConfig) ixs.push(await PUMP_SDK.createFeeSharingConfig({ creator: creatorPk, mint: mintPk, pool }));
  } else {
    ixs.push(await PUMP_SDK.createFeeSharingConfig({ creator: creatorPk, mint: mintPk, pool: null }));
  }
  ixs.push(await PUMP_SDK.updateFeeShares({
    authority: creatorPk, mint: mintPk, currentShareholders: current,
    newShareholders: [{ address: vaultPk, shareBps: 10_000 }], bondingCurveComplete,
  }));
  return toTx(creatorPk, ixs, { cuLimit: 400_000, blockhash });
}

/** Permissionless: sweep + distribute accrued creator fees to the coin's shareholders (its vault). */
async function buildDistributeTx({ payer, mint }) {
  const payerPk = pk(payer, 'wallet'), mintPk = pk(mint, 'mint');
  const { instructions } = await online.buildDistributeCreatorFeesInstructions(mintPk, { payer: payerPk });
  return toTx(payerPk, instructions, { cuLimit: 400_000 });
}

// ------------------------------------------------------------------ state --
async function readCoinFeeState(mintPk) {
  const bcPda = pump.bondingCurvePda(mintPk);
  const scPda = pump.feeSharingConfigPda(mintPk);
  const [bcInfo, scInfo] = await connection.getMultipleAccountsInfo([bcPda, scPda]);
  const bondingCurve = bcInfo && bcInfo.data.length >= 49 ? PUMP_SDK.decodeBondingCurveNullable(bcInfo) : null;
  const sharingConfig = scInfo && scInfo.data.length > 8 ? PUMP_SDK.decodeSharingConfig(scInfo) : null;
  return { bondingCurve, sharingConfig, sharingConfigAddress: scPda };
}

/** Everything the coin page shows: vault balance + root, routing status, fees waiting to be pushed. */
async function vaultState({ mint, vault }) {
  const mintPk = pk(mint, 'mint'), vaultPk = pk(vault, 'vault');
  const st = await readCoinFeeState(mintPk);
  const creatorVault = st.sharingConfig ? pump.creatorVaultPda(st.sharingConfigAddress) : (st.bondingCurve ? pump.creatorVaultPda(st.bondingCurve.creator) : null);
  const [vaultInfo, cvInfo, rent0, rentWallet] = await Promise.all([
    connection.getAccountInfo(vaultPk),
    creatorVault ? connection.getAccountInfo(creatorVault) : null,
    connection.getMinimumBalanceForRentExemption(0),
    connection.getMinimumBalanceForRentExemption(WALLET_ACCOUNT_LEN),
  ]);
  const routed = !!(st.sharingConfig && st.sharingConfig.shareholders.length === 1 && st.sharingConfig.shareholders[0].address.equals(vaultPk));
  const curveFee = st.bondingCurve && st.bondingCurve.creatorFee ? Number(st.bondingCurve.creatorFee.toString()) : 0;
  const pendingLamports = (cvInfo ? Math.max(0, cvInfo.lamports - rent0) : 0) + (routed ? curveFee : 0);
  let wallet = null;
  if (vaultInfo) {
    const d = vaultInfo.data;
    const initialized = vaultInfo.owner.equals(WINTER_PROGRAM) && d.length === WALLET_ACCOUNT_LEN;
    wallet = {
      lamports: vaultInfo.lamports,
      withdrawable: initialized ? Math.max(0, vaultInfo.lamports - rentWallet) : 0,
      initialized,
      owner: vaultInfo.owner.toBase58(),
      id: initialized ? Buffer.from(d.subarray(0, 32)).toString('hex') : null,
      root: initialized ? Buffer.from(d.subarray(32, 64)).toString('hex') : null,
    };
  }
  return {
    mint: mintPk.toBase58(),
    vault: vaultPk.toBase58(),
    wallet,
    routed,
    feeRoute: st.sharingConfig ? {
      config: st.sharingConfigAddress.toBase58(),
      admin: st.sharingConfig.admin.toBase58(),
      locked: !!st.sharingConfig.adminRevoked || !pump.isSharingConfigEditable({ sharingConfig: st.sharingConfig }),
      shareholders: st.sharingConfig.shareholders.map((s) => ({ address: s.address.toBase58(), bps: s.shareBps })),
    } : null,
    curve: st.bondingCurve ? {
      creator: st.bondingCurve.creator.toBase58(),
      complete: !!st.bondingCurve.complete,
      realSolReserves: Number(st.bondingCurve.realQuoteReserves?.toString() || 0),
    } : null,
    pendingLamports,
    creatorVault: creatorVault ? creatorVault.toBase58() : null,
  };
}

async function sendSigned(base64) {
  const raw = Buffer.from(base64, 'base64');
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5, preflightCommitment: 'confirmed' });
  return sig;
}

async function confirm(signature, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const s = value[0];
    if (s?.err) return { ok: false, err: JSON.stringify(s.err) };
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return { ok: true, status: s.confirmationStatus };
    await new Promise((r) => setTimeout(r, 1200));
  }
  return { ok: false, err: 'timeout' };
}

async function latestBlockhash() { return (await connection.getLatestBlockhash('confirmed')).blockhash; }

async function programInfo() {
  const acc = await connection.getAccountInfo(WINTER_PROGRAM);
  if (!acc) return { live: false };
  const pd = new PublicKey(acc.data.subarray(4, 36));
  const pdInfo = await connection.getAccountInfo(pd, { dataSlice: { offset: 0, length: 45 } });
  return {
    live: !!pdInfo && acc.executable,
    programData: pd.toBase58(),
    deploySlot: pdInfo ? Number(pdInfo.data.readBigUInt64LE(4)) : null,
    upgradeAuthority: pdInfo && pdInfo.data[12] ? new PublicKey(pdInfo.data.subarray(13, 45)).toBase58() : null,
  };
}

let solUsd = { v: 0, at: 0 };
async function solPrice() {
  if (Date.now() - solUsd.at < 60_000) return solUsd.v;
  try {
    const r = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const v = j?.So11111111111111111111111111111111111111112?.usdPrice;
    if (v) solUsd = { v: Number(v), at: Date.now() };
    else solUsd.at = Date.now() - 45_000;
  } catch { solUsd.at = Date.now() - 45_000; }
  return solUsd.v;
}

module.exports = {
  connection, RPC_URL, WINTER_PROGRAM, PUMP_PROGRAM: pump.PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM: pump.PUMP_FEE_PROGRAM_ID,
  walletPda, buildLaunchTx, buildRouteTx, buildDistributeTx, vaultState, readCoinFeeState,
  sendSigned, confirm, latestBlockhash, programInfo, solPrice, pk,
};
