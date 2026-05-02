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

    pub fn compute_challenge(
        last_checkin_slot: u64,
        owner: &Pubkey,
        blockhash: &[u8; 32], 
    ) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&last_checkin_slot.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        data.extend_from_slice(blockhash);
        hash(&data).to_bytes()
    }
    pub fn apply_slot_buffer(interval_slots: u64) -> u64 {
        (interval_slots as f64 * SLOT_DRIFT_BUFFER) as u64
    }}


#[program]
pub mod lastword {
    use super::*;

    //1 
    pub fn create_switch(
        ctx : Context<CreateSwitch>,
        switch_id : u8,
        switch_type : SwitchType,
        beneficiary_type : BeneficiaryType,
        beneficiary : Pubkey,
        interval_days : u64,
        payload_hash : [u8; 32],
        arweave_tx_id : [u8; 43],
        escrowed_amount : u64,
    ) -> Result<()> {
        require!(switch_id < MX_SWITCHES_PER_WALLET, LastWordError::InvalidSwitchId);
        let interval_slots_raw = interval_days * SLOTS_PER_DAY;
        require!(
            interval_slots_raw >= MIN_INTERVAL_SLOTS && interval_slots_raw <= MAX_INTERVAL_SLOTS,
            LastWordError::InvalidInterval
        );
        let interval_slots = SwitchAccount::apply_slot_buffer(interval_slots_raw);
        let clock = Clock::get()?;
        let current_slot = clock.slot;

        let recent_blockhash = ctx.accounts.recent_blockhashes.data.borrow();
        let blockhash_bytes: [u8; 32] = recent_blockhash[8..40].try_into().unwrap_or([0u8; 32]);
        let challenge_nonce = SwitchAccount::compute_challenge(
            current_slot,
            &ctx.accounts.owner.key(),
            &blockhash_bytes,
        );

        let sw = &mut ctx.accounts.switch_account;
        sw.owner = ctx.accounts.owner.key();
        sw.switch_id = switch_id;
        sw.bump = ctx.bumps.switch_account;
        sw.switch_type = switch_type;
        sw.beneficiary_type = beneficiary_type;
        sw.beneficiary = beneficiary;
        sw.checkin_interval_slots = interval_slots;
        sw.deadline_slot = current_slot + interval_slots;
        sw.last_checkin_slot = current_slot;
        sw.checkin_window_open = current_slot;
        sw.challenge_nonce = challenge_nonce;
        sw.status = SwitchStatus::Active;
        sw.payload_hash = payload_hash;
        sw.arweave_tx_id = arweave_tx_id;
        sw.escrowed_mint = None;
        sw.escrowed_amount = escrowed_amount;
        sw.protocol_fee_paid = PROTOCOL_FEE_LAMPORTS;
        sw.created_at_slot = current_slot;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.switch_account.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, PROTOCOL_FEE_LAMPORTS)?;
 
        emit!(SwitchCreated {
            owner: ctx.accounts.owner.key(),
            switch_id,
            switch_type: sw.switch_type.clone(),
            deadline_slot: sw.deadline_slot,
        });
 
        Ok(())
    }

    //2. 

}

#[error_code]
pub enum LastWordError {
    #[msg("Switch ID must be between 0 and 4")]
    InvalidSwitchId,
    #[msg("Interval must be between 3 and 365 days")]
    InvalidInterval,
    #[msg("Switch is not in Active status")]
    SwitchNotActive,
    #[msg("Deadline has already passed — switch should be triggered")]
    DeadlinePassed,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Invalid ed25519 signature over challenge nonce")]
    InvalidSignature,
    #[msg("Cannot cancel within 48 hours of creation")]
    CancelCooldownActive,
    #[msg("Wallet has reached the maximum of 5 active switches")]
    SwitchLimitReached,
}
