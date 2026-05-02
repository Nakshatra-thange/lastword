import { CONFIG } from "./config";

export interface MessageTriggeredEvent {
  owner: string;
  switchId: number;
  arweaveTxId: number[];   
  payloadHash: number[];  
}

export interface PublishedMessage {
  arweaveTxId: string;
  arweaveUrl: string;
  payloadHash: string;
  owner: string;
  switchId: number;
  publishedAt: string;
  content: any;            
  verified: boolean;       
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesToString(bytes: number[]): string {
  return Buffer.from(bytes).toString("utf-8").replace(/\0/g, "").trim();
}

function bytesToHex(bytes: number[]): string {
  return Buffer.from(bytes).toString("hex");
}

async function sha256(data: Buffer): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(data).digest("hex");
}

// ─── Fetch from Arweave ───────────────────────────────────────────────────────

async function fetchArweaveContent(txId: string): Promise<Buffer> {
  const url = `${CONFIG.ARWEAVE_GATEWAY}/${txId}`;
  console.log(`[publisher] Fetching Arweave content from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Arweave fetch failed: ${response.status} ${response.statusText}`);
  }

  const raw = await response.arrayBuffer();
  return Buffer.from(raw);
}

// ─── Verify payload hash ──────────────────────────────────────────────────────

async function verifyHash(content: Buffer, expectedHashBytes: number[]): Promise<boolean> {
  const actualHash = await sha256(content);
  const expectedHash = bytesToHex(expectedHashBytes);

  const match = actualHash === expectedHash;
  if (match) {
    console.log(`[publisher] Hash verified: ${actualHash.slice(0, 16)}...`);
  } else {
    console.error(`[publisher] Hash mismatch!`);
    console.error(`  expected: ${expectedHash}`);
    console.error(`  actual:   ${actualHash}`);
  }
  return match;
}

// ─── Main publish function ─────────────────────────────────────────────────────


export const publishedMessages: PublishedMessage[] = [];

export async function publishMessage(event: MessageTriggeredEvent): Promise<PublishedMessage | null> {
  const arweaveTxId = bytesToString(event.arweaveTxId);
  const payloadHashHex = bytesToHex(event.payloadHash);

  console.log(`[publisher] Processing MessageTriggered event`);
  console.log(`[publisher] owner=${event.owner} switchId=${event.switchId}`);
  console.log(`[publisher] arweave_tx_id=${arweaveTxId}`);
  console.log(`[publisher] expected_hash=${payloadHashHex.slice(0, 16)}...`);

  
  const alreadyPublished = publishedMessages.find(m => m.arweaveTxId === arweaveTxId);
  if (alreadyPublished) {
    console.log(`[publisher] Already published — skipping`);
    return alreadyPublished;
  }


  let content: Buffer;
  try {
    content = await fetchArweaveContent(arweaveTxId);
  } catch (err: any) {
    console.error(`[publisher] Failed to fetch Arweave content:`, err.message);
    // Retry once after 5 seconds (Arweave can be slow)
    await new Promise(r => setTimeout(r, 5000));
    try {
      content = await fetchArweaveContent(arweaveTxId);
    } catch (retryErr: any) {
      console.error(`[publisher] Retry also failed:`, retryErr.message);
      return null;
    }
  }

  
  const verified = await verifyHash(content, event.payloadHash);


  let parsedContent: any;
  try {
    parsedContent = JSON.parse(content.toString("utf-8"));
  } catch {

    parsedContent = { raw: content.toString("utf-8") };
  }

  const published: PublishedMessage = {
    arweaveTxId,
    arweaveUrl:  `${CONFIG.ARWEAVE_GATEWAY}/${arweaveTxId}`,
    payloadHash: payloadHashHex,
    owner:       event.owner,
    switchId:    event.switchId,
    publishedAt: new Date().toISOString(),
    content:     parsedContent,
    verified,
  };

  publishedMessages.push(published);

  console.log(`[publisher] ✅ Published message from ${event.owner}`);
  console.log(`[publisher] Arweave URL: ${published.arweaveUrl}`);
  console.log(`[publisher] Verified: ${verified}`);

  return published;
}