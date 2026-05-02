use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("D4Frg928RDwrsxYHZnjcwHhMVz8VaKy2zo4raMc1cLL6");

pub const MX_SWITCHES_PER_WALLET : u8 = 5;
pub const MIN_INTERVAL_SLOT : u64 = 3 * 24 * 60 * 60 * 1000 / 400;
pub const MAX_INTERVAL_SLOT : u64 = 365 * 24 * 60 * 60 * 1000 / 400;
pub const SLOT_DRIFT_BUFFER : f64 = 0.95;
pub const PROTOCOL_FEE_LAMPORTS: u64 = 10_000_000; // 0.01 SOL trigger bounty
pub const SLOTS_PER_DAY: u64 = 216_000;

// enums

#[program]
pub mod lastword {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
