use anchor_lang::prelude::*;
use anchor_spl::associated_token;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
    },
    pod::PodAccount,
};
use anchor_spl::token_interface::{
    burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface,
};
use anchor_lang::solana_program::sysvar;
use mpl_token_metadata::instructions::{CreateV1InstructionArgs, CreateV1};
use mpl_token_metadata::types::{ PrintSupply, TokenStandard};
use anchor_lang::solana_program::program::invoke_signed;
use mpl_token_metadata::ID as MPL_TOKEN_METADATA_ID;
use spl_discriminator::discriminator::SplDiscriminate;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{
    ExecuteInstruction, InitializeExtraAccountMetaListInstruction,
};

mod errors;
use errors::ErrorCode;

declare_id!("A3jca3XyW52j1aMdpE75affvCtgyN4UwNc1Sn2ahLzo6");

#[program]
pub mod potter_potter {
    use super::*;

    pub fn create_factory(ctx: Context<CreateFactoryCTX>) -> Result<()> {
        ctx.accounts.factory.set_inner(TokenFactory {
            authority: ctx.accounts.authority.key(),
            token_count: 0,
        });
        msg!(
            "Factory created with authority: {}",
            ctx.accounts.authority.key()
        );
        Ok(())
    }

    pub fn create_token(
        ctx: Context<CreateTokenCTX>,
        total_supply: u64,
        name: String,
        symbol: String,
        uri: String,
        default_address: Pubkey,
    ) -> Result<()> {
        // Validation
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);
        require!(uri.len() <= 200, ErrorCode::UriTooLong);
        require!(total_supply > 0, ErrorCode::InvalidAmount);

        let factory = &mut ctx.accounts.factory;
        let token_count = factory.token_count;

        // Initialize token data
        ctx.accounts.token_data.set_inner(TokenData {
            mint: ctx.accounts.mint.key(),
            authority: factory.authority,
            total_supply,
            decimals: 9,
            is_paused: false,
            is_minting_paused: false,
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            whitelist: ctx.accounts.whitelist.key(),
        });

        // Initialize whitelist with default address
        ctx.accounts.whitelist.set_inner(Whitelist {
            addresses: vec![default_address],
        });

        factory.token_count = token_count.checked_add(1).unwrap();

        // Create associated token account for the authority
        let cpi_accounts = associated_token::Create {
            payer: ctx.accounts.authority.to_account_info(),
            associated_token: ctx.accounts.ata.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            cpi_accounts,
        ))?;

        // Create metadata
        let bump_seed = [ctx.bumps.mint_authority_pda];
        let signer_seeds = &[&[
            b"mint_authority",
            ctx.accounts.authority.key.as_ref(),
            &bump_seed,
        ][..]];

        let ix = CreateV1 {
            metadata: ctx.accounts.metadata.key(),
            master_edition: None,
            mint: (ctx.accounts.mint.key(), false),
            authority: ctx.accounts.mint_authority_pda.key(),
            payer: ctx.accounts.authority.key(),
            update_authority: (ctx.accounts.mint_authority_pda.key(), true),
            system_program: ctx.accounts.system_program.key(),
            sysvar_instructions: sysvar::instructions::ID,
            spl_token_program: Some(ctx.accounts.token_program.key()),
        }
        .instruction(CreateV1InstructionArgs {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            primary_sale_happened: false,
            is_mutable: true,
            token_standard: TokenStandard::Fungible,
            collection: None,
            uses: None,
            collection_details: None,
            rule_set: None,
            decimals: Some(9),
            print_supply: Some(PrintSupply::Zero),
        });

        invoke_signed(
            &ix,
            &[
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.mint_authority_pda.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_metadata_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        // Mint initial supply using PDA authority
        msg!("Minting initial supply: {} tokens", total_supply);

        let raw_supply = total_supply
            .checked_mul(10u64.pow(ctx.accounts.token_data.decimals as u32))
            .ok_or(ErrorCode::InvalidAmount)?;

        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.ata.to_account_info(),
                    authority: ctx.accounts.mint_authority_pda.to_account_info(),
                },
                signer_seeds,
            ),
            raw_supply,
        )?;

        msg!("Token created successfully");
        Ok(())
    }

    pub fn add_to_whitelist(
        ctx: Context<AddToWhitelistCTX>,
        _token_count: u64,
        addresses: Vec<Pubkey>,
    ) -> Result<()> {
        require!(!addresses.is_empty(), ErrorCode::InvalidAmount);

        for addr in &addresses {
            if !ctx.accounts.whitelist.addresses.contains(addr) {
                ctx.accounts.whitelist.addresses.push(*addr);
            }
        }

        msg!("Added {} addresses to whitelist", addresses.len());
        Ok(())
    }

    pub fn remove_from_whitelist(
        ctx: Context<RemoveFromWhitelistCTX>,
        _token_count: u64,
        addresses: Vec<Pubkey>,
    ) -> Result<()> {
        for addr in addresses {
            ctx.accounts.whitelist.addresses.retain(|&x| x != addr);
        }
        msg!("Removed addresses from whitelist");
        Ok(())
    }

    pub fn get_whitelist(ctx: Context<GetWhitelistCTX>, _token_count: u64) -> Result<()> {
        msg!(
            "Total whitelisted addresses: {}",
            ctx.accounts.whitelist.addresses.len()
        );
        for (i, addr) in ctx.accounts.whitelist.addresses.iter().enumerate() {
            msg!("Address {}: {}", i, addr);
        }
        Ok(())
    }

    pub fn mint_tokens(ctx: Context<MintTokensCTX>, _token_count: u64, amount: u64) -> Result<()> {
        require!(
            !ctx.accounts.token_data.is_minting_paused,
            ErrorCode::MintingPaused
        );
        require!(amount > 0, ErrorCode::InvalidAmount);

        let raw_amount = amount
            .checked_mul(10u64.pow(ctx.accounts.token_data.decimals as u32))
            .ok_or(ErrorCode::InvalidAmount)?;

        let authority_key = ctx.accounts.authority.key();
        let seeds = &[
            b"mint_authority",
            authority_key.as_ref(),
            &[ctx.bumps.mint_authority_pda],
        ];
        let signer_seeds = &[&seeds[..]];

        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.mint_authority_pda.to_account_info(),
                },
                signer_seeds,
            ),
            raw_amount,
        )?;

        // Update total supply (store human-readable amount)
        ctx.accounts.token_data.total_supply = ctx
            .accounts
            .token_data
            .total_supply
            .checked_add(amount)
            .ok_or(ErrorCode::InvalidAmount)?;

        msg!("Minted {} tokens", amount);
        Ok(())
    }

    pub fn burn_tokens(ctx: Context<BurnTokensCTX>, _token_count: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let raw_amount = amount
            .checked_mul(10u64.pow(ctx.accounts.token_data.decimals as u32))
            .ok_or(ErrorCode::InvalidAmount)?;

        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.from.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            raw_amount,
        )?;

        // Update total supply (store human-readable amount)
        ctx.accounts.token_data.total_supply = ctx
            .accounts
            .token_data
            .total_supply
            .checked_sub(amount)
            .ok_or(ErrorCode::InvalidAmount)?;

        msg!("Burned {} tokens", amount);
        Ok(())
    }

    pub fn pause_minting(ctx: Context<PauseMintingCTX>, _token_count: u64) -> Result<()> {
        ctx.accounts.token_data.is_minting_paused = !ctx.accounts.token_data.is_minting_paused;
        msg!(
            "Minting paused: {}",
            ctx.accounts.token_data.is_minting_paused
        );
        Ok(())
    }

    pub fn pause_token(ctx: Context<PauseTokenCTX>, _token_count: u64) -> Result<()> {
        ctx.accounts.token_data.is_paused = !ctx.accounts.token_data.is_paused;
        msg!("Token paused: {}", ctx.accounts.token_data.is_paused);
        Ok(())
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthorityCTX>,
        _token_count: u64,
        new_authority: Pubkey,
    ) -> Result<()> {
        let old_authority = ctx.accounts.token_data.authority;
        ctx.accounts.token_data.authority = new_authority;
        msg!(
            "Authority transferred from {} to {}",
            old_authority,
            new_authority
        );
        Ok(())
    }

    // ============ TRANSFER HOOK IMPLEMENTATION ============

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        check_is_transferring(&ctx)?;

        let destination_owner = ctx.accounts.destination_token.owner;

        // Check if destination is whitelisted
        require!(
            ctx.accounts
                .whitelist
                .addresses
                .contains(&destination_owner),
            ErrorCode::AddressNotWhitelisted
        );

        msg!(
            "Transfer hook passed: destination {} is whitelisted",
            destination_owner
        );
        Ok(())
    }

    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
        _token_count: u64,
    ) -> Result<()> {
        let extra_account_metas = InitializeExtraAccountMetaList::extra_account_metas(
            &ctx.accounts.authority.key(),
            _token_count,
        )?;

        // Initialize ExtraAccountMetaList account with extra accounts
        // Convert ProgramError to anchor_lang::error::Error
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas,
        )
        .map_err(|e| {
            msg!("Error initializing extra account meta list: {:?}", e);
            error!(ErrorCode::InvalidAmount)
        })?;

        msg!(
            "Transfer hook initialized for mint: {}",
            ctx.accounts.mint.key()
        );
        Ok(())
    }
}

// ============ ACCOUNTS STRUCTS ============

#[derive(Accounts)]
pub struct CreateFactoryCTX<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8,
        seeds = [b"factory", authority.key().as_ref()],
        bump
    )]
    pub factory: Account<'info, TokenFactory>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateTokenCTX<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"factory", authority.key().as_ref()],
        bump
    )]
    pub factory: Account<'info, TokenFactory>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1 + 1 + 1 + (4 + 32) + (4 + 10) + (4 + 200) + 32,
        seeds = [b"token", authority.key().as_ref(), &factory.token_count.to_le_bytes()],
        bump
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(
        init,
        payer = authority,
        space = 8 + 4 + (32 * 10),
        seeds = [b"whitelist", authority.key().as_ref(), &factory.token_count.to_le_bytes()],
        bump
    )]
    pub whitelist: Account<'info, Whitelist>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = mint_authority_pda,
        mint::freeze_authority = mint_authority_pda,
        mint::token_program = token_program,
        extensions::transfer_hook::authority = mint_authority_pda,
        extensions::transfer_hook::program_id = crate::ID,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"mint_authority", authority.key().as_ref()],
        bump
    )]
    /// CHECK: PDA used as mint authority
    pub mint_authority_pda: UncheckedAccount<'info>,

    /// CHECK: Created via CPI to associated token program
    #[account(mut)]
    pub ata: UncheckedAccount<'info>,

    /// CHECK: Validated by token metadata program
    #[account(
        mut,
        seeds = [
            b"metadata",
            MPL_TOKEN_METADATA_ID.as_ref(),
            mint.key().as_ref()
        ],
        bump,
        seeds::program =MPL_TOKEN_METADATA_ID 
    )]
    pub metadata: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = anchor_spl::associated_token::ID)]
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: Token Metadata Program
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct AddToWhitelistCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(
        mut,
        address = token_data.whitelist,
        realloc = 8 + 4 + ((whitelist.addresses.len() + 10) * 32),
        realloc::payer = authority,
        realloc::zero = false,
    )]
    pub whitelist: Account<'info, Whitelist>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct RemoveFromWhitelistCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(
        mut,
        address = token_data.whitelist,
    )]
    pub whitelist: Account<'info, Whitelist>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct GetWhitelistCTX<'info> {
    /// CHECK: Authority check done via seeds
    pub authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(address = token_data.whitelist)]
    pub whitelist: Account<'info, Whitelist>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct MintTokensCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(
        mut,
        constraint = mint.key() == token_data.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = to.mint == token_data.mint
    )]
    pub to: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"mint_authority", authority.key().as_ref()],
        bump
    )]
    /// CHECK: PDA used as mint authority
    pub mint_authority_pda: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct BurnTokensCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(
        mut,
        constraint = mint.key() == token_data.mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = from.mint == token_data.mint
    )]
    pub from: InterfaceAccount<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct PauseMintingCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct PauseTokenCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct TransferAuthorityCTX<'info> {
    #[account(
        mut,
        seeds = [b"token", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        has_one = authority
    )]
    pub token_data: Account<'info, TokenData>,
    pub authority: Signer<'info>,
}

// ============ TRANSFER HOOK ACCOUNTS ============

#[derive(Accounts)]
#[instruction(token_count: u64)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList Account
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas(&authority.key(), token_count)?.len()
        ).map_err(|_| error!(ErrorCode::InvalidAmount))?,
        payer = payer
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Authority for deriving whitelist PDA
    pub authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"whitelist", authority.key().as_ref(), &token_count.to_le_bytes()],
        bump
    )]
    pub whitelist: Account<'info, Whitelist>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas(
        _authority: &Pubkey,
        _token_count: u64,
    ) -> Result<Vec<ExtraAccountMeta>> {
        // Create the ExtraAccountMeta and handle the Result
        let meta = ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"whitelist".to_vec(),
                },
                Seed::AccountKey { index: 0 }, // authority
                Seed::AccountData {
                    account_index: 0,
                    data_index: 0,
                    length: 8,
                },
            ],
            false, // is_signer
            true,  // is_writable
        )
        .map_err(|_| error!(ErrorCode::InvalidAmount))?;

        Ok(vec![meta])
    }
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: source token account owner, can be SystemAccount or PDA
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList Account
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // This is passed via extra account metas
    pub whitelist: Account<'info, Whitelist>,
}

// ============ DATA STRUCTS ============

#[account]
pub struct TokenFactory {
    pub authority: Pubkey,
    pub token_count: u64,
}

#[account]
pub struct TokenData {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub total_supply: u64,
    pub decimals: u8,
    pub is_paused: bool,
    pub is_minting_paused: bool,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub whitelist: Pubkey,
}

#[account]
pub struct Whitelist {
    pub addresses: Vec<Pubkey>,
}

// ============ HELPER FUNCTIONS ============

fn check_is_transferring(ctx: &Context<TransferHook>) -> Result<()> {
    let source_token_info = ctx.accounts.source_token.to_account_info();
    let mut account_data_ref: std::cell::RefMut<&mut [u8]> =
        source_token_info.try_borrow_mut_data()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;

    if !bool::from(account_extension.transferring) {
        return err!(ErrorCode::IsNotCurrentlyTransferring);
    }

    Ok(())
}