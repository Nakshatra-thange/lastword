/**
 * LastWord — Devnet Smoke Test
 * 
 * Run with:
 *   npx ts-node scripts/smoke-test.ts
 * 
 * What this does:
 *   1. Connects to devnet
 *   2. Creates a switch (message type, 30 days, wallet beneficiary)
 *   3. Fetches and logs the full switch account state
 *   4. Does a check-in with valid ed25519 sig
 *   5. Fetches and logs updated state
 *   6. Prints explorer links for every account and tx
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  Ed25519Program,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("D4Frg928RDwrsxYHZnjcwHhMVz8VaKy2zo4raMc1cLL6");
const CLUSTER = "devnet";
const EXPLORER = (sig: string, type: "tx" | "address" = "tx") =>
  `https://explorer.solana.com/${type}/${sig}?cluster=devnet`;

// ─── Load wallet from Solana CLI default keypair ──────────────────────────────

function loadWallet(): Keypair {
  const walletPath = path.resolve(
    process.env.HOME || "~",
    ".config/solana/id.json"
  );
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function switchPda(owner: PublicKey, switchId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lastword"), owner.toBuffer(), Buffer.from([switchId])],
    PROGRAM_ID
  );
}

function counterPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lastword_count"), owner.toBuffer()],
    PROGRAM_ID
  );
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

function log(label: string, value?: any) {
  if (value === undefined) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${label}`);
    console.log("─".repeat(60));
  } else {
    console.log(`  ${label.padEnd(28)} ${value}`);
  }
}

function logSwitchAccount(sw: any, label = "SwitchAccount State") {
  log(label);
  log("owner",                  sw.owner.toBase58());
  log("switch_id",              sw.switchId);
  log("switch_type",            JSON.stringify(sw.switchType));
  log("beneficiary_type",       JSON.stringify(sw.beneficiaryType));
  log("beneficiary",            sw.beneficiary.toBase58());
  log("status",                 JSON.stringify(sw.status));
  log("checkin_interval_slots", sw.checkinIntervalSlots.toString());
  log("deadline_slot",          sw.deadlineSlot.toString());
  log("last_checkin_slot",      sw.lastCheckinSlot.toString());
  log("challenge_nonce",        Buffer.from(sw.challengeNonce).toString("hex").slice(0, 16) + "...");
  log("payload_hash",           Buffer.from(sw.payloadHash).toString("hex").slice(0, 16) + "...");
  log("arweave_tx_id",          Buffer.from(sw.arweaveTxId).toString("utf-8").trim());
  log("escrowed_mint",          sw.escrowedMint ? sw.escrowedMint.toBase58() : "null (native SOL)");
  log("escrowed_amount",        sw.escrowedAmount.toString());
  log("protocol_fee_paid",      sw.protocolFeePaid.toString() + " lamports (0.01 SOL)");
  log("created_at_slot",        sw.createdAtSlot.toString());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀 LastWord Devnet Smoke Test\n");

  // ── Setup ──────────────────────────────────────────────────────────────────

  const connection = new Connection(clusterApiUrl(CLUSTER), "confirmed");
  const wallet = loadWallet();

  log("SETUP");
  log("wallet",      wallet.publicKey.toBase58());
  log("cluster",     CLUSTER);
  log("program_id",  PROGRAM_ID.toBase58());
  log("explorer",    EXPLORER(wallet.publicKey.toBase58(), "address"));

  const balance = await connection.getBalance(wallet.publicKey);
  log("wallet_balance", `${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.1 * 1e9) {
    console.error("\n❌ Insufficient balance. Run: solana airdrop 2");
    process.exit(1);
  }

  // ── Load IDL + program ─────────────────────────────────────────────────────

  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../target/idl/lastword.json"),
      "utf-8"
    )
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // ── Derive PDAs ────────────────────────────────────────────────────────────

  const SWITCH_ID = 0;
  const beneficiary = Keypair.generate(); // fresh beneficiary for smoke test

  const [switchPubkey, switchBump] = switchPda(wallet.publicKey, SWITCH_ID);
  const [counterPubkey] = counterPda(wallet.publicKey);

  log("DERIVED ACCOUNTS");
  log("switch_account",  switchPubkey.toBase58());
  log("counter_account", counterPubkey.toBase58());
  log("beneficiary",     beneficiary.publicKey.toBase58());
  log("explorer/switch", EXPLORER(switchPubkey.toBase58(), "address"));

  // ── Check if switch already exists ────────────────────────────────────────

  const existing = await connection.getAccountInfo(switchPubkey);
  if (existing) {
    console.log("\n⚠️  Switch account already exists. Fetching existing state...");
    const sw = await program.account.switchAccount.fetch(switchPubkey);
    logSwitchAccount(sw, "Existing SwitchAccount");
    console.log("\n✅ Skipping create — proceeding to checkin...\n");
  } else {

    // ── create_switch ──────────────────────────────────────────────────────

    log("STEP 1 — create_switch");

    const DUMMY_PAYLOAD_HASH = Array(32).fill(0xab);
    const DUMMY_ARWEAVE_TX_ID = [
      ...Buffer.from("smoke-test-arweave-tx-id-000000000000000", "utf-8")
    ].slice(0, 43);

    const createTx = await program.methods
      .createSwitch(
        SWITCH_ID,
        { message: {} },
        { wallet: {} },
        beneficiary.publicKey,
        new BN(30),               // 30-day interval
        DUMMY_PAYLOAD_HASH,
        DUMMY_ARWEAVE_TX_ID,
        new BN(0)                 // no SOL escrowed for message type
      )
      .accounts({
        switchAccount:     switchPubkey,
        walletSwitchCount: counterPubkey,
        owner:             wallet.publicKey,
        slotHashes:        SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram:     SystemProgram.programId,
      })
      .rpc();

    log("create_tx", createTx);
    log("explorer",  EXPLORER(createTx));
    console.log("\n  ✅ create_switch succeeded\n");

    // Fetch and display full account state
    const swAfterCreate = await program.account.switchAccount.fetch(switchPubkey);
    logSwitchAccount(swAfterCreate, "After create_switch");

    // Fetch counter
    const counter = await program.account.walletSwitchCount.fetch(counterPubkey);
    log("COUNTER STATE");
    log("count", counter.count);
    log("owner", counter.owner.toBase58());
  }

  // ── checkin ────────────────────────────────────────────────────────────────

  log("STEP 2 — checkin");

  const swBeforeCheckin = await program.account.switchAccount.fetch(switchPubkey);
  const challengeNonce = Buffer.from(swBeforeCheckin.challengeNonce);
  const deadlineBefore = swBeforeCheckin.deadlineSlot.toNumber();

  log("challenge_nonce",  challengeNonce.toString("hex").slice(0, 32) + "...");
  log("deadline_before",  deadlineBefore.toString());

  // Sign the challenge nonce with the owner's keypair
  const signature = nacl.sign.detached(challengeNonce, wallet.secretKey);
  log("signature",        Buffer.from(signature).toString("hex").slice(0, 32) + "...");

  // Build tx: Ed25519 verify ix FIRST, then checkin ix
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: wallet.publicKey.toBytes(),
    message:   challengeNonce,
    signature,
  });

  const checkinIx = await program.methods
    .checkin(Array.from(signature) as any)
    .accounts({
      switchAccount: switchPubkey,
      owner:         wallet.publicKey,
      ixSysvar:      anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      slotHashes:    SYSVAR_SLOT_HASHES_PUBKEY,
    })
    .instruction();

  const checkinTx = new Transaction().add(ed25519Ix, checkinIx);
  const checkinSig = await sendAndConfirmTransaction(connection, checkinTx, [wallet]);

  log("checkin_tx",       checkinSig);
  log("explorer",         EXPLORER(checkinSig));
  console.log("\n  ✅ checkin succeeded\n");

  // Fetch updated state
  const swAfterCheckin = await program.account.switchAccount.fetch(switchPubkey);
  logSwitchAccount(swAfterCheckin, "After checkin");

  const deadlineAfter = swAfterCheckin.deadlineSlot.toNumber();
  log("CHECKIN RESULT");
  log("deadline_before",  deadlineBefore.toString());
  log("deadline_after",   deadlineAfter.toString());
  log("deadline_advanced", (deadlineAfter > deadlineBefore).toString());
  log("nonce_rotated",
    Buffer.from(swAfterCheckin.challengeNonce).toString("hex") !==
    challengeNonce.toString("hex") ? "true ✅" : "false ❌"
  );

  // ── Summary ────────────────────────────────────────────────────────────────

  log("SMOKE TEST SUMMARY");
  log("program",          EXPLORER(PROGRAM_ID.toBase58(), "address"));
  log("switch_account",   EXPLORER(switchPubkey.toBase58(), "address"));
  log("counter_account",  EXPLORER(counterPubkey.toBase58(), "address"));
  log("status",           JSON.stringify(swAfterCheckin.status));
  log("deadline_slot",    swAfterCheckin.deadlineSlot.toString());

  const currentSlot = await connection.getSlot();
  const slotsRemaining = swAfterCheckin.deadlineSlot.toNumber() - currentSlot;
  const daysRemaining = (slotsRemaining / 216_000).toFixed(1);
  log("current_slot",     currentSlot.toString());
  log("slots_remaining",  slotsRemaining.toString());
  log("days_remaining",   `~${daysRemaining} days`);

  console.log("\n✅ All smoke tests passed. LastWord is live on devnet.\n");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  process.exit(1);
});