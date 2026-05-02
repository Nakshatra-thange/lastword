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
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SwitchType{
    Message ,
    Asset ,
    Instruction ,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum BeneficiaryType {
    Wallet,  
    Squads,   
    Arweave,  
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SwitchStatus {
    Active,     
    Triggered,  
    Cancelled,  
}
 
//accounts
pub struct SwitchAccount {
    pub owner :Pubkey ,
    pub switch_id : u8 ,
    pub bump :u8 ,

    pub switch_type: SwitchType,           // 1
    pub beneficiary_type: BeneficiaryType, // 1
    pub beneficiary: Pubkey, 

    pub checkin_interval_slots: u64,  // 8
    pub deadline_slot: u64,           // 8
    pub last_checkin_slot: u64,       // 8
    pub checkin_window_open: u64,     // 8
    pub challenge_nonce: [u8; 32], 

    pub status : SwitchStatus,

    pub payload_hash : [u8 , 32],
    pub arweave_tx_id: [u8; 43], 

    pub escrowed_mint: Option<Pubkey>, // 33 (1 discriminant + 32)
    pub escrowed_amount: u64,  

    pub protocol_fee_paid: u64,  
    pub created_at_slot: u64,

}

impl SwitchAccount {
    // 8 discriminator + all fields above
    pub const LEN: usize = 8 + 32 + 1 + 1 + 1 + 1 + 32 + 8 + 8 + 8 + 8 + 32 + 1 + 32 + 43 + 33 + 8 + 8 + 8;
    


#[program]
pub mod lastword {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
