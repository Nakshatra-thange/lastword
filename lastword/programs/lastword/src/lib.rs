use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use solana_program::ed25519_program;
use solana_program::hash::hash;

declare_id!("D4Frg928RDwrsxYHZnjcwHhMVz8VaKy2zo4raMc1cLL6");

// ─── Constants ───────────────────────────────────────────────────────────────

pub const MAX_SWITCHES_PER_WALLET: u8 = 5;
pub const MIN_INTERVAL_SLOTS: u64 = 3 * 216_000;         // 3 days
pub const MAX_INTERVAL_SLOTS: u64 = 365 * 216_000;       // 365 days
pub const SLOT_DRIFT_BUFFER: f64 = 0.95;
pub const PROTOCOL_FEE_LAMPORTS: u64 = 10_000_000;       // 0.01 SOL
pub const SLOTS_PER_DAY: u64 = 216_000;

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SwitchType {
    Message,
    Asset,
    Instruction,
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

// ─── Accounts ────────────────────────────────────────────────────────────────

/// Tracks how many active switches a wallet currently has.
/// PDA seed: ["lastword_count", owner]
#[account]
pub struct WalletSwitchCount {
    pub owner: Pubkey,   // 32
    pub count: u8,       // 1
    pub bump: u8,        // 1
}

impl WalletSwitchCount {
    pub const LEN: usize = 8 + 32 + 1 + 1;
}

/// One switch per PDA. Seed: ["lastword", owner, switch_id]
#[account]
pub struct SwitchAccount {
    // Identity
    pub owner: Pubkey,     // 32
    pub switch_id: u8,     // 1
    pub bump: u8,          // 1

    // Type
    pub switch_type: SwitchType,            // 1
    pub beneficiary_type: BeneficiaryType,  // 1
    pub beneficiary: Pubkey,                // 32

    // Liveness
    pub checkin_interval_slots: u64,  // 8
    pub deadline_slot: u64,           // 8
    pub last_checkin_slot: u64,       // 8
    pub checkin_window_open: u64,     // 8
    pub challenge_nonce: [u8; 32],    // 32

    // Status
    pub status: SwitchStatus,  // 1

    // Payload (Message type)
    pub payload_hash: [u8; 32],   // 32
    pub arweave_tx_id: [u8; 43], // 43

    // Asset escrow
    pub escrowed_mint: Option<Pubkey>,  // 33
    pub escrowed_amount: u64,           // 8

    // Protocol
    pub protocol_fee_paid: u64,  // 8
    pub created_at_slot: u64,    // 8
}

impl SwitchAccount {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 1 + 1 + 32 + 8 + 8 + 8 + 8 + 32 + 1 + 32 + 43 + 33 + 8 + 8 + 8;

    pub fn compute_challenge(
        last_checkin_slot: u64,
        owner: &Pubkey,
        slot_hash_bytes: &[u8; 32],
    ) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&last_checkin_slot.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        data.extend_from_slice(slot_hash_bytes);
        hash(&data).to_bytes()
    }

    pub fn apply_slot_buffer(interval_slots: u64) -> u64 {
        (interval_slots as f64 * SLOT_DRIFT_BUFFER) as u64
    }
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod lastword {
    use super::*;

    // ── 1. create_switch ─────────────────────────────────────────────────────

    pub fn create_switch(
        ctx: Context<CreateSwitch>,
        switch_id: u8,
        switch_type: SwitchType,
        beneficiary_type: BeneficiaryType,
        beneficiary: Pubkey,
        interval_days: u64,
        payload_hash: [u8; 32],
        arweave_tx_id: [u8; 43],
        escrowed_amount: u64,
    ) -> Result<()> {
        require!(switch_id < MAX_SWITCHES_PER_WALLET, LastWordError::InvalidSwitchId);
        let owner_key = ctx.accounts.owner.key();
        let switch_account_info = ctx.accounts.switch_account.to_account_info();

        // FIX 1: enforce 5-switch cap via WalletSwitchCount PDA
        let counter = &mut ctx.accounts.wallet_switch_count;
        require!(counter.count < MAX_SWITCHES_PER_WALLET, LastWordError::SwitchLimitReached);

        // Validate interval
        let interval_slots_raw = interval_days * SLOTS_PER_DAY;
        require!(
            interval_slots_raw >= MIN_INTERVAL_SLOTS && interval_slots_raw <= MAX_INTERVAL_SLOTS,
            LastWordError::InvalidInterval
        );
        let interval_slots = SwitchAccount::apply_slot_buffer(interval_slots_raw);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        // FIX 2: use SlotHashes sysvar instead of deprecated RecentBlockhashes
        let slot_hashes_data = ctx.accounts.slot_hashes.data.borrow();
        // SlotHashes layout: 8 bytes (count as u64 LE), then entries of (slot: u64, hash: [u8;32])
        // We read the hash of the most recent slot entry (offset 8 + 8 = 16, length 32)
        let slot_hash_bytes: [u8; 32] = if slot_hashes_data.len() >= 48 {
            slot_hashes_data[16..48].try_into().unwrap_or([0u8; 32])
        } else {
            [0u8; 32]
        };

        let challenge_nonce = SwitchAccount::compute_challenge(
            current_slot,
            &owner_key,
            &slot_hash_bytes,
        );

        // Initialise counter on first use
        if counter.count == 0 {
            counter.owner = owner_key;
            counter.bump = ctx.bumps.wallet_switch_count;
        }
        counter.count += 1;

        {
            let sw = &mut ctx.accounts.switch_account;
            sw.owner = owner_key;
            sw.switch_id = switch_id;
            sw.bump = ctx.bumps.switch_account;
            sw.switch_type = switch_type.clone();
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
        }

        // Collect protocol fee into the PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: switch_account_info,
                },
            ),
            PROTOCOL_FEE_LAMPORTS,
        )?;

        emit!(SwitchCreated {
            owner: owner_key,
            switch_id,
            switch_type,
            deadline_slot: current_slot + interval_slots,
        });

        Ok(())
    }

    // ── 2. checkin ───────────────────────────────────────────────────────────

    pub fn checkin(ctx: Context<Checkin>, signature: [u8; 64]) -> Result<()> {
        let sw = &mut ctx.accounts.switch_account;

        require!(sw.status == SwitchStatus::Active, LastWordError::SwitchNotActive);

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        require!(current_slot <= sw.deadline_slot, LastWordError::DeadlinePassed);

        // Verify ed25519 sig over challenge_nonce — cannot be pre-signed or automated
        verify_ed25519_signature(
            &ctx.accounts.ix_sysvar,
            &ctx.accounts.owner.key(),
            &sw.challenge_nonce,
            &signature,
        )?;

        sw.last_checkin_slot = current_slot;
        sw.checkin_window_open = current_slot;

        // FIX 2: SlotHashes sysvar for new nonce
        let slot_hashes_data = ctx.accounts.slot_hashes.data.borrow();
        let slot_hash_bytes: [u8; 32] = if slot_hashes_data.len() >= 48 {
            slot_hashes_data[16..48].try_into().unwrap_or([0u8; 32])
        } else {
            [0u8; 32]
        };

        sw.challenge_nonce = SwitchAccount::compute_challenge(
            current_slot,
            &ctx.accounts.owner.key(),
            &slot_hash_bytes,
        );

        sw.deadline_slot = current_slot + sw.checkin_interval_slots;

        emit!(CheckinCompleted {
            owner: ctx.accounts.owner.key(),
            switch_id: sw.switch_id,
            new_deadline_slot: sw.deadline_slot,
        });

        Ok(())
    }

    // ── 3. trigger (SOL asset + message + instruction) ───────────────────────
    // Permissionless after deadline. Caller earns 0.01 SOL bounty.

    pub fn trigger(ctx: Context<Trigger>) -> Result<()> {
        let sw = &mut ctx.accounts.switch_account;

        require!(sw.status == SwitchStatus::Active, LastWordError::SwitchNotActive);

        let clock = Clock::get()?;
        require!(clock.slot > sw.deadline_slot, LastWordError::DeadlineNotReached);

        // Re-entrancy guard — mark triggered before any transfers
        sw.status = SwitchStatus::Triggered;

        match sw.switch_type {
            SwitchType::Asset => {
                // Only handles native SOL here.
                // SPL tokens → use trigger_spl instruction.
                require!(sw.escrowed_mint.is_none(), LastWordError::UseTriggerSpl);
                let amount = sw.escrowed_amount;
                **sw.to_account_info().try_borrow_mut_lamports()? -= amount;
                **ctx.accounts.beneficiary.try_borrow_mut_lamports()? += amount;
            }
            SwitchType::Message => {
                emit!(MessageTriggered {
                    owner: sw.owner,
                    switch_id: sw.switch_id,
                    arweave_tx_id: sw.arweave_tx_id,
                    payload_hash: sw.payload_hash,
                });
            }
            SwitchType::Instruction => {
                emit!(InstructionTriggered {
                    owner: sw.owner,
                    switch_id: sw.switch_id,
                    beneficiary: sw.beneficiary,
                });
            }
        }

        // Pay bounty to caller
        let bounty = sw.protocol_fee_paid;
        **sw.to_account_info().try_borrow_mut_lamports()? -= bounty;
        **ctx.accounts.caller.try_borrow_mut_lamports()? += bounty;
        sw.protocol_fee_paid = 0;

        emit!(SwitchTriggered {
            owner: sw.owner,
            switch_id: sw.switch_id,
            triggered_by: ctx.accounts.caller.key(),
            slot: clock.slot,
        });

        Ok(())
    }

    // ── 3b. trigger_spl ──────────────────────────────────────────────────────
    // FIX 3: dedicated instruction for SPL token asset switches.
    // Permissionless after deadline. Caller earns 0.01 SOL bounty.

    pub fn trigger_spl(ctx: Context<TriggerSpl>) -> Result<()> {
        let switch_account_info = ctx.accounts.switch_account.to_account_info();
        let sw = &mut ctx.accounts.switch_account;

        require!(sw.status == SwitchStatus::Active, LastWordError::SwitchNotActive);
        require!(sw.switch_type == SwitchType::Asset, LastWordError::WrongSwitchType);
        require!(sw.escrowed_mint.is_some(), LastWordError::NotSplSwitch);

        let clock = Clock::get()?;
        require!(clock.slot > sw.deadline_slot, LastWordError::DeadlineNotReached);

        sw.status = SwitchStatus::Triggered;

        let amount = sw.escrowed_amount;
        let owner_key = sw.owner;
        let switch_id = sw.switch_id;
        let bump = sw.bump;

        // PDA signs the CPI transfer
        let seeds = &[
            b"lastword".as_ref(),
            owner_key.as_ref(),
            &[switch_id],
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.beneficiary_token_account.to_account_info(),
                    authority: switch_account_info,
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Pay bounty to caller
        let bounty = sw.protocol_fee_paid;
        **sw.to_account_info().try_borrow_mut_lamports()? -= bounty;
        **ctx.accounts.caller.try_borrow_mut_lamports()? += bounty;
        sw.protocol_fee_paid = 0;

        emit!(SwitchTriggered {
            owner: sw.owner,
            switch_id: sw.switch_id,
            triggered_by: ctx.accounts.caller.key(),
            slot: clock.slot,
        });

        Ok(())
    }

    // ── 4. cancel ────────────────────────────────────────────────────────────

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let sw = &ctx.accounts.switch_account;

        require!(sw.status == SwitchStatus::Active, LastWordError::SwitchNotActive);

        let clock = Clock::get()?;
        require!(
            clock.slot >= sw.created_at_slot + (2 * SLOTS_PER_DAY),
            LastWordError::CancelCooldownActive
        );

        // Return native SOL escrow to owner
        if sw.switch_type == SwitchType::Asset && sw.escrowed_mint.is_none() {
            let amount = sw.escrowed_amount;
            **ctx.accounts.switch_account.to_account_info().try_borrow_mut_lamports()? -= amount;
            **ctx.accounts.owner.try_borrow_mut_lamports()? += amount;
        }

        // FIX 4: SPL token escrow returned to owner via cancel_spl instruction.
        // If escrowed_mint.is_some() and user calls cancel (not cancel_spl), reject.
        require!(
            sw.escrowed_mint.is_none() || sw.switch_type != SwitchType::Asset,
            LastWordError::UseCancelSpl
        );

        // Decrement the wallet switch counter
        let counter = &mut ctx.accounts.wallet_switch_count;
        counter.count = counter.count.saturating_sub(1);

        emit!(SwitchCancelled {
            owner: ctx.accounts.owner.key(),
            switch_id: sw.switch_id,
        });

        Ok(())
        // Anchor closes the account and returns rent to owner via `close = owner`
    }

    // ── 4b. cancel_spl ───────────────────────────────────────────────────────
    // FIX 4: returns SPL tokens to owner before closing the switch account.

    pub fn cancel_spl(ctx: Context<CancelSpl>) -> Result<()> {
        let sw = &ctx.accounts.switch_account;

        require!(sw.status == SwitchStatus::Active, LastWordError::SwitchNotActive);
        require!(sw.switch_type == SwitchType::Asset, LastWordError::WrongSwitchType);
        require!(sw.escrowed_mint.is_some(), LastWordError::NotSplSwitch);

        let clock = Clock::get()?;
        require!(
            clock.slot >= sw.created_at_slot + (2 * SLOTS_PER_DAY),
            LastWordError::CancelCooldownActive
        );

        let amount = sw.escrowed_amount;
        let owner_key = sw.owner;
        let switch_id = sw.switch_id;
        let bump = sw.bump;

        let seeds = &[
            b"lastword".as_ref(),
            owner_key.as_ref(),
            &[switch_id],
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Return tokens from PDA escrow ATA → owner ATA
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.switch_account.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Decrement counter
        let counter = &mut ctx.accounts.wallet_switch_count;
        counter.count = counter.count.saturating_sub(1);

        emit!(SwitchCancelled {
            owner: ctx.accounts.owner.key(),
            switch_id: sw.switch_id,
        });

        Ok(())
        // Anchor closes the account via `close = owner`
    }
}

// ─── Contexts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(switch_id: u8)]
pub struct CreateSwitch<'info> {
    #[account(
        init,
        payer = owner,
        space = SwitchAccount::LEN,
        seeds = [b"lastword", owner.key().as_ref(), &[switch_id]],
        bump
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    // FIX 1: WalletSwitchCount PDA — init_if_needed so first switch creates it
    #[account(
        init_if_needed,
        payer = owner,
        space = WalletSwitchCount::LEN,
        seeds = [b"lastword_count", owner.key().as_ref()],
        bump
    )]
    pub wallet_switch_count: Account<'info, WalletSwitchCount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    // FIX 2: SlotHashes sysvar replaces deprecated RecentBlockhashes
    /// CHECK: SlotHashes sysvar — read-only, address validated below
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Checkin<'info> {
    #[account(
        mut,
        seeds = [b"lastword", owner.key().as_ref(), &[switch_account.switch_id]],
        bump = switch_account.bump,
        has_one = owner
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    pub owner: Signer<'info>,

    /// CHECK: ix sysvar — required for ed25519 sig verification
    #[account(address = ix_sysvar::ID)]
    pub ix_sysvar: AccountInfo<'info>,

    // FIX 2: SlotHashes sysvar
    /// CHECK: SlotHashes sysvar — address validated
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Trigger<'info> {
    #[account(
        mut,
        seeds = [b"lastword", switch_account.owner.as_ref(), &[switch_account.switch_id]],
        bump = switch_account.bump,
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    /// CHECK: validated via constraint against switch_account.beneficiary
    #[account(
        mut,
        constraint = beneficiary.key() == switch_account.beneficiary
            || switch_account.beneficiary_type == BeneficiaryType::Arweave
            @ LastWordError::WrongBeneficiary
    )]
    pub beneficiary: AccountInfo<'info>,

    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// FIX 3: TriggerSpl context — handles SPL token asset switches
#[derive(Accounts)]
pub struct TriggerSpl<'info> {
    #[account(
        mut,
        seeds = [b"lastword", switch_account.owner.as_ref(), &[switch_account.switch_id]],
        bump = switch_account.bump,
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    /// Escrow ATA owned by the switch PDA
    #[account(
        mut,
        constraint = escrow_token_account.owner == switch_account.key()
            @ LastWordError::WrongTokenAccount,
        constraint = escrow_token_account.mint == switch_account.escrowed_mint.unwrap()
            @ LastWordError::WrongTokenAccount,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Beneficiary's ATA — must match switch_account.beneficiary
    #[account(
        mut,
        constraint = beneficiary_token_account.owner == switch_account.beneficiary
            @ LastWordError::WrongBeneficiary,
        constraint = beneficiary_token_account.mint == switch_account.escrowed_mint.unwrap()
            @ LastWordError::WrongTokenAccount,
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub caller: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"lastword", owner.key().as_ref(), &[switch_account.switch_id]],
        bump = switch_account.bump,
        has_one = owner,
        close = owner
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    // FIX 1: update counter on cancel
    #[account(
        mut,
        seeds = [b"lastword_count", owner.key().as_ref()],
        bump = wallet_switch_count.bump,
        has_one = owner
    )]
    pub wallet_switch_count: Account<'info, WalletSwitchCount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// FIX 4: CancelSpl context — returns SPL tokens before closing account
#[derive(Accounts)]
pub struct CancelSpl<'info> {
    #[account(
        mut,
        seeds = [b"lastword", owner.key().as_ref(), &[switch_account.switch_id]],
        bump = switch_account.bump,
        has_one = owner,
        close = owner
    )]
    pub switch_account: Account<'info, SwitchAccount>,

    #[account(
        mut,
        seeds = [b"lastword_count", owner.key().as_ref()],
        bump = wallet_switch_count.bump,
        has_one = owner
    )]
    pub wallet_switch_count: Account<'info, WalletSwitchCount>,

    /// Escrow ATA owned by the switch PDA
    #[account(
        mut,
        constraint = escrow_token_account.owner == switch_account.key()
            @ LastWordError::WrongTokenAccount,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Owner's ATA to receive tokens back
    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key()
            @ LastWordError::WrongTokenAccount,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── Ed25519 Verification ─────────────────────────────────────────────────────

fn verify_ed25519_signature(
    ix_sysvar: &AccountInfo,
    pubkey: &Pubkey,
    message: &[u8; 32],
    signature: &[u8; 64],
) -> Result<()> {
    let current_index = ix_sysvar::load_current_index_checked(ix_sysvar)
        .map_err(|_| LastWordError::InvalidSignature)?;
    require!(current_index > 0, LastWordError::InvalidSignature);

    let ix = ix_sysvar::load_instruction_at_checked((current_index - 1) as usize, ix_sysvar)
        .map_err(|_| LastWordError::InvalidSignature)?;

    require!(
        ix.program_id == ed25519_program::ID,
        LastWordError::InvalidSignature
    );

    let data = ix.data;
    msg!("checkin current ix index: {}", current_index);
    msg!("ed25519 ix data len: {}", data.len());
    // Ed25519Program encodes a 16-byte header with offsets into the payload.
    require!(data.len() >= 16, LastWordError::InvalidSignature);

    let num_signatures = data[0];
    require!(num_signatures == 1, LastWordError::InvalidSignature);

    let read_u16 = |start: usize| -> Option<usize> {
        let bytes: [u8; 2] = data.get(start..start + 2)?.try_into().ok()?;
        Some(u16::from_le_bytes(bytes) as usize)
    };

    let signature_offset = read_u16(2).ok_or(LastWordError::InvalidSignature)?;
    let public_key_offset = read_u16(6).ok_or(LastWordError::InvalidSignature)?;
    let message_data_offset = read_u16(10).ok_or(LastWordError::InvalidSignature)?;
    let message_data_size = read_u16(12).ok_or(LastWordError::InvalidSignature)?;
    msg!(
        "ed25519 offsets sig={} pk={} msg={} msg_size={}",
        signature_offset,
        public_key_offset,
        message_data_offset,
        message_data_size
    );

    require!(message_data_size == 32, LastWordError::InvalidSignature);

    let ix_signature = data
        .get(signature_offset..signature_offset + 64)
        .ok_or(LastWordError::InvalidSignature)?;
    let ix_pubkey = data
        .get(public_key_offset..public_key_offset + 32)
        .ok_or(LastWordError::InvalidSignature)?;
    let ix_message = data
        .get(message_data_offset..message_data_offset + message_data_size)
        .ok_or(LastWordError::InvalidSignature)?;

    require!(ix_pubkey == pubkey.as_ref(), LastWordError::InvalidSignature);
    require!(ix_signature == signature.as_ref(), LastWordError::InvalidSignature);
    require!(ix_message == message.as_ref(), LastWordError::InvalidSignature);

    Ok(())
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[event]
pub struct SwitchCreated {
    pub owner: Pubkey,
    pub switch_id: u8,
    pub switch_type: SwitchType,
    pub deadline_slot: u64,
}

#[event]
pub struct CheckinCompleted {
    pub owner: Pubkey,
    pub switch_id: u8,
    pub new_deadline_slot: u64,
}

#[event]
pub struct SwitchTriggered {
    pub owner: Pubkey,
    pub switch_id: u8,
    pub triggered_by: Pubkey,
    pub slot: u64,
}

#[event]
pub struct MessageTriggered {
    pub owner: Pubkey,
    pub switch_id: u8,
    pub arweave_tx_id: [u8; 43],
    pub payload_hash: [u8; 32],
}

#[event]
pub struct InstructionTriggered {
    pub owner: Pubkey,
    pub switch_id: u8,
    pub beneficiary: Pubkey,
}

#[event]
pub struct SwitchCancelled {
    pub owner: Pubkey,
    pub switch_id: u8,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

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
    #[msg("SPL asset switch — use trigger_spl instruction")]
    UseTriggerSpl,
    #[msg("SPL asset switch — use cancel_spl instruction")]
    UseCancelSpl,
    #[msg("Wrong switch type for this instruction")]
    WrongSwitchType,
    #[msg("This switch does not have an SPL mint")]
    NotSplSwitch,
    #[msg("Beneficiary account does not match switch record")]
    WrongBeneficiary,
    #[msg("Token account does not match expected mint or owner")]
    WrongTokenAccount,
}
