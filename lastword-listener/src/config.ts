import dotenv from 'dotenv';
import fs from "fs";
import path from "path";

dotenv.config();

function required(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  }

function resolveWalletSecret(): string {
  const inlineSecret = process.env.WALLET_SECRET?.trim();
  if (inlineSecret) return inlineSecret;

  const candidatePaths = [
    process.env.WALLET_SECRET_FILE,
    path.resolve(process.cwd(), "../listener-wallet.json"),
    path.resolve(process.cwd(), "listener-wallet.json"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8").trim();
    }
  }

  throw new Error(
    "Missing wallet secret. Set WALLET_SECRET or WALLET_SECRET_FILE, or place listener-wallet.json next to the workspace."
  );
}

export const CONFIG = {
  
    RPC_URL:        process.env.RPC_URL || "https://api.devnet.solana.com",
    PROGRAM_ID:     required("PROGRAM_ID"),
    WALLET_SECRET:  resolveWalletSecret(), // JSON array of the listener's keypair bytes
   
    
    HELIUS_API_KEY:    required("HELIUS_API_KEY"),
    HELIUS_WEBHOOK_ID: process.env.HELIUS_WEBHOOK_ID || "", // filled after first registration
   
    
    PORT:           process.env.PORT || "3001",
    WEBHOOK_SECRET: required("WEBHOOK_SECRET"), // random string you choose — validates Helius calls
   
   
    ARWEAVE_GATEWAY: process.env.ARWEAVE_GATEWAY || "https://arweave.net",
  };

  
export const SLOTS_PER_DAY = 216_000;
export const PROTOCOL_FEE  = 10_000_000;
