import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  
} from "@solana/web3.js";
import { CONFIG } from "./config";
import type { Lastword } from "../../lastword/target/types/lastword";
import fs from "fs";
import path from "path";

//Setup 

function getConnection(): Connection {
  return new Connection(CONFIG.RPC_URL, "confirmed");
}

function getWallet(): Keypair {
  const secret = JSON.parse(CONFIG.WALLET_SECRET);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

type LastwordProgram = anchor.Program<Lastword>;

function getProgram(connection: Connection, wallet: Keypair): LastwordProgram {
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../target/idl/lastword.json"), "utf-8")
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  
  const idlWithAddress = {
    ...(idl as object),
    address: CONFIG.PROGRAM_ID,
  } as anchor.Idl & { address: string };
  
  return new anchor.Program(idlWithAddress as anchor.Idl, provider) as LastwordProgram;
}


function switchPda(owner: PublicKey, switchId: number, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lastword"), owner.toBuffer(), Buffer.from([switchId])],
    programId
  );
  return pda;
}



export interface TriggerPayload {
  ownerPubkey: string;
  switchId: number;
  switchType: "message" | "asset" | "instruction";
  beneficiaryPubkey: string;
  deadlineSlot: number;
}

export async function executeTrigger(payload: TriggerPayload): Promise<string | null> {
  const connection = getConnection();
  const wallet = getWallet();
  const program = getProgram(connection, wallet);
  const programId = new PublicKey(CONFIG.PROGRAM_ID);

  const owner = new PublicKey(payload.ownerPubkey);
  const beneficiary = new PublicKey(payload.beneficiaryPubkey);
  const switchAccPubkey = switchPda(owner, payload.switchId, programId);

  // Verify the account still exists and is still Active before attempting trigger
  let sw: any;
  try {
    sw = await program.account.switchAccount.fetch(switchAccPubkey);
  } catch {
    console.log(`[trigger] Switch account not found: ${switchAccPubkey.toBase58()}`);
    return null;
  }

  if (!sw.status.active) {
    console.log(`[trigger] Switch ${switchAccPubkey.toBase58()} is not Active — skipping`);
    return null;
  }

  // Verify deadline has actually passed
  const currentSlot = await connection.getSlot();
  if (currentSlot <= sw.deadlineSlot.toNumber()) {
    const slotsLeft = sw.deadlineSlot.toNumber() - currentSlot;
    console.log(`[trigger] Deadline not yet passed. ${slotsLeft} slots remaining — skipping`);
    return null;
  }

  console.log(`[trigger] Firing trigger for switch ${switchAccPubkey.toBase58()}`);
  console.log(`[trigger] owner=${payload.ownerPubkey} switchId=${payload.switchId}`);
  console.log(`[trigger] deadline_slot=${sw.deadlineSlot} current_slot=${currentSlot}`);

  try {
    const txSig = await program.methods
      .trigger()
      .accounts({
        switchAccount: switchAccPubkey,
        beneficiary:   beneficiary,
        caller:        wallet.publicKey,
      })
      .rpc();

    console.log(`[trigger] Success! tx=${txSig}`);
    console.log(`[trigger] Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
    return txSig;
  } catch (err: any) {
    console.error(`[trigger] Failed:`, err.message);

    if (err.message?.includes("UseTriggerSpl")) {
      console.log(`[trigger] Retrying with trigger_spl...`);
      return executeTriggerSpl(payload, switchAccPubkey, program, wallet);
    }

    return null;
  }
}

async function executeTriggerSpl(
  payload: TriggerPayload,
  switchAccPubkey: PublicKey,
  program: LastwordProgram,
  wallet: Keypair
): Promise<string | null> {

  try {
    const sw = await program.account.switchAccount.fetch(switchAccPubkey);
    const mint = sw.escrowedMint as PublicKey;
    const beneficiary = sw.beneficiary as PublicKey;

    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const escrowAta      = await getAssociatedTokenAddress(mint, switchAccPubkey, true);
    const beneficiaryAta = await getAssociatedTokenAddress(mint, beneficiary);

    const txSig = await program.methods
      .triggerSpl()
      .accounts({
        switchAccount:          switchAccPubkey,
        escrowTokenAccount:     escrowAta,
        beneficiaryTokenAccount: beneficiaryAta,
        caller:                 wallet.publicKey,
      })
      .rpc();

    console.log(`[trigger_spl] Success! tx=${txSig}`);
    return txSig;
  } catch (err: any) {
    console.error(`[trigger_spl] Failed:`, err.message);
    return null;
  }
}


export async function pollDeadlines(knownSwitches: TriggerPayload[]) {
  if (knownSwitches.length === 0) return;

  const connection = getConnection();
  const currentSlot = await connection.getSlot();
  console.log(`[poller] Checking ${knownSwitches.length} switches at slot ${currentSlot}`);

  for (const sw of knownSwitches) {
    const slotsUntilDeadline = sw.deadlineSlot - currentSlot;

    if (slotsUntilDeadline <= 0) {
      console.log(`[poller] Switch ${sw.ownerPubkey}:${sw.switchId} is past deadline — triggering`);
      await executeTrigger(sw);
    } else if (slotsUntilDeadline <= 43_200) {

      const hoursLeft = (slotsUntilDeadline / 14_400).toFixed(1);
      console.log(`[poller]  Switch ${sw.ownerPubkey}:${sw.switchId} expires in ~${hoursLeft}h`);
    }
  }
}