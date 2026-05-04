import express, { Request, Response } from "express";
import { CONFIG} from "./config";
import { executeTrigger, pollDeadlines, TriggerPayload } from "./trigger";
import { publishMessage, publishedMessages, MessageTriggeredEvent } from "./publisher";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Lastword } from "./idl/lastword";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// ─── In-memory switch registry ────────────────────────────────────────────────
// In production, persist this to a database (Postgres, Redis, etc.)
// For the demo this is fine — it rebuilds from on-chain state on restart.

const switchRegistry: Map<string, TriggerPayload> = new Map();

type LastwordProgram = anchor.Program<Lastword>;

function getReadonlyProgram(connection: Connection): LastwordProgram {
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "idl/lastword.json"), "utf-8")
  ) as Lastword;

  const provider = new anchor.AnchorProvider(connection, {} as anchor.Wallet, {
    commitment: "confirmed",
  });

  return new anchor.Program<Lastword>(idl, provider);
}

function registryKey(owner: string, switchId: number): string {
  return `${owner}:${switchId}`;
}

// ─── Helius webhook event types ───────────────────────────────────────────────

interface HeliusWebhookBody {
  webhookType: string;
  accountData?: any[];
  events?:      any[];
  logs?:        string[];
  signature?:   string;
  slot?:        number;
}

// ─── Webhook signature validation ─────────────────────────────────────────────

function validateWebhookSecret(req: Request): boolean {
  const secret = req.headers["authorization"] || req.query.secret;
  return secret === CONFIG.WEBHOOK_SECRET;
}

// ─── Parse Helius program event logs ─────────────────────────────────────────

function parseEventFromLogs(logs: string[], eventName: string): any | null {
  // Anchor emits events as base64-encoded data in program logs.
  // Helius includes raw logs in the webhook payload.
  // Look for "Program log: " prefix followed by the event discriminator.
  for (const log of logs) {
    if (log.includes("Program data:")) {
      try {
        const b64 = log.split("Program data: ")[1]?.trim();
        if (!b64) continue;
        const decoded = Buffer.from(b64, "base64");
        // First 8 bytes are the Anchor event discriminator
        // We decode the rest as the event payload — in production use the IDL
        return { raw: decoded.toString("hex"), log };
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check — Render uses this to verify the service is alive
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status:    "ok",
    program:   CONFIG.PROGRAM_ID,
    switches:  switchRegistry.size,
    published: publishedMessages.length,
    timestamp: new Date().toISOString(),
  });
});

// Published messages explorer — frontend hits this to show triggered messages
app.get("/published", (_req: Request, res: Response) => {
  res.json({
    count:    publishedMessages.length,
    messages: publishedMessages,
  });
});

// Switch registry — for debugging
app.get("/switches", (_req: Request, res: Response) => {
  const switches = Array.from(switchRegistry.values());
  res.json({ count: switches.length, switches });
});

// ── Helius webhook — SwitchCreated ────────────────────────────────────────────
// Helius calls this when a new SwitchAccount is created on-chain.
// We register the switch so the poller can watch its deadline.

app.post("/webhook/created", async (req: Request, res: Response) => {
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body: HeliusWebhookBody = req.body;
  console.log(`[webhook/created] Received event, slot=${body.slot}`);

  try {
    // Parse the SwitchCreated event from account data
    // Helius enhanced transactions include parsed account state changes
    const accountData = body.accountData?.[0];
    if (!accountData) {
      return res.status(200).json({ status: "no account data" });
    }

    // Re-fetch the full account state from chain to get all fields
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const program = getReadonlyProgram(connection);

    const switchPubkey = new PublicKey(accountData.account);
    const sw = await program.account.switchAccount.fetch(switchPubkey);

    const payload: TriggerPayload = {
      ownerPubkey:       sw.owner.toBase58(),
      switchId:          sw.switchId,
      switchType:        Object.keys(sw.switchType)[0] as any,
      beneficiaryPubkey: sw.beneficiary.toBase58(),
      deadlineSlot:      sw.deadlineSlot.toNumber(),
    };

    const key = registryKey(payload.ownerPubkey, payload.switchId);
    switchRegistry.set(key, payload);

    console.log(`[webhook/created] Registered switch ${key}, deadline_slot=${payload.deadlineSlot}`);
    return res.json({ status: "registered", key });
  } catch (err: any) {
    console.error(`[webhook/created] Error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Helius webhook — MessageTriggered ─────────────────────────────────────────
// Helius calls this when a MessageTriggered event is emitted.
// We fetch the Arweave content and publish it.

app.post("/webhook/triggered", async (req: Request, res: Response) => {
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body: HeliusWebhookBody = req.body;
  console.log(`[webhook/triggered] Received event, slot=${body.slot}, sig=${body.signature}`);

  // Immediately respond to Helius — processing is async
  res.json({ status: "processing" });

  try {
    const logs = body.logs || [];

    // Check if this is a MessageTriggered event by scanning logs
    const isMessageTrigger = logs.some(l => l.includes("MessageTriggered") || l.includes("Program data:"));

    if (!isMessageTrigger) {
      console.log(`[webhook/triggered] Not a MessageTriggered event — skipping`);
      return;
    }

    // Re-fetch the full event from chain using the transaction signature
    // In production, parse the Anchor event directly from the log data
    // For the demo, we extract from the Helius enhanced transaction
    const accountData = body.accountData?.[0];
    if (!accountData) {
      console.log(`[webhook/triggered] No account data in payload`);
      return;
    }

    // Build the event from account data
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const program = getReadonlyProgram(connection);

    const switchPubkey = new PublicKey(accountData.account);
    const sw = await program.account.switchAccount.fetch(switchPubkey);

    const event: MessageTriggeredEvent = {
      owner:       sw.owner.toBase58(),
      switchId:    sw.switchId,
      arweaveTxId: Array.from(sw.arweaveTxId),
      payloadHash: Array.from(sw.payloadHash),
    };

    // Remove from registry
    const key = registryKey(event.owner, event.switchId);
    switchRegistry.delete(key);
    console.log(`[webhook/triggered] Removed ${key} from registry`);

    // Publish the message
    await publishMessage(event);

  } catch (err: any) {
    console.error(`[webhook/triggered] Error:`, err.message);
  }
});

// ── Manual trigger endpoint (for demo / testing) ──────────────────────────────

app.post("/trigger/:owner/:switchId", async (req: Request, res: Response) => {
  if (!validateWebhookSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { owner, switchId } = req.params;
  if (!owner || !switchId) {
    return res.status(400).json({ error: "Missing owner or switchId route params" });
  }
  const key = registryKey(owner, parseInt(switchId));
  const payload = switchRegistry.get(key);

  if (!payload) {
    return res.status(404).json({ error: `Switch ${key} not in registry` });
  }

  const txSig = await executeTrigger(payload);
  if (txSig) {
    return res.json({ status: "triggered", tx: txSig });
  } else {
    return res.status(400).json({ status: "trigger_failed" });
  }
});

// ─── Deadline poller ──────────────────────────────────────────────────────────
// Runs every 10 minutes as a safety net alongside the webhook.

function startPoller() {
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  async function poll() {
    const switches = Array.from(switchRegistry.values());
    await pollDeadlines(switches);
  }

  // Run immediately on start, then every 10 minutes
  poll();
  setInterval(poll, INTERVAL_MS);
  console.log(`[poller] Started — checking every 10 minutes`);
}

// ─── On-chain registry sync ───────────────────────────────────────────────────
// On startup, scan all existing SwitchAccount PDAs and populate the registry.
// This recovers state after a Render service restart.

async function syncRegistryFromChain() {
  console.log(`[sync] Syncing switch registry from chain...`);
  try {
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const programId = new PublicKey(CONFIG.PROGRAM_ID);
    const program = getReadonlyProgram(connection);

    // Fetch all SwitchAccount accounts for this program
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        { dataSize: 273 }, // SwitchAccount::LEN
      ],
    });

    let registered = 0;
    for (const { pubkey, account } of accounts) {
      try {
        const sw = await program.account.switchAccount.fetch(pubkey);

        // Only watch Active switches
        if (!sw.status.active) continue;

        const payload: TriggerPayload = {
          ownerPubkey:       sw.owner.toBase58(),
          switchId:          sw.switchId,
          switchType:        Object.keys(sw.switchType)[0] as any,
          beneficiaryPubkey: sw.beneficiary.toBase58(),
          deadlineSlot:      sw.deadlineSlot.toNumber(),
        };

        const key = registryKey(payload.ownerPubkey, payload.switchId);
        switchRegistry.set(key, payload);
        registered++;
      } catch {
        // Skip accounts that fail to deserialize
      }
    }

    console.log(`[sync] Registered ${registered} active switches from chain`);
  } catch (err: any) {
    console.error(`[sync] Failed to sync from chain:`, err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  console.log(`\n LastWord Listener starting...`);
  console.log(`   program_id: ${CONFIG.PROGRAM_ID}`);
  console.log(`   rpc:        ${CONFIG.RPC_URL}`);

  await syncRegistryFromChain();
  startPoller();

  app.listen(CONFIG.PORT, () => {
    console.log(`\n Listener running on port ${CONFIG.PORT}`);
    console.log(`   /health    → service status`);
    console.log(`   /switches  → active switch registry`);
    console.log(`   /published → triggered messages`);
  });
}

start().catch(console.error);
