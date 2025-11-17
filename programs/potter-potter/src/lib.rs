use anchor_lang::prelude::*;
use anchor_spl::token::{burn, mint_to, transfer, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use mpl_token_metadata::instructions::{CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs};
use mpl_token_metadata::types::DataV2;

pub mod errors;
use errors::ErrorCode;

declare_id!("A3jca3XyW52j1aMdpE75affvCtgyN4UwNc1Sn2ahLzo6");

#[program]
pub mod potter_potter {
    use super::*;
    use anchor_lang::solana_program::program::invoke;

    pub fn create_factory(ctx: Context<CreateFactoryCTX>) -> Result<()> {
        ctx.accounts.factory.set_inner(TokenFactory {
            authority: ctx.accounts.authority.key(),
            token_count: 0,
        });
        Ok(())
    }

    pub fn create_token(
        ctx: Context<CreateTokenCTX>,
        total_supply: u64,
        decimals: u8,
        name: String,
        symbol: String,
        uri: String,
        default_address: Pubkey,
    ) -> Result<()> {
        require!(name.len() <= 32, ErrorCode::InvalidAmount);
        require!(symbol.len() <= 10, ErrorCode::InvalidAmount);
        require!(uri.len() <= 200, ErrorCode::InvalidAmount);

        let factory = &mut ctx.accounts.factory;
        let token_count = factory.token_count;

        ctx.accounts.token_data.set_inner(TokenData {
            mint: ctx.accounts.mint.key(),
            authority: factory.authority,
            total_supply,
            decimals,
            is_paused: false,
            is_minting_paused: false,
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            whitelist: ctx.accounts.whitelist.key(),
        });

        ctx.accounts.whitelist.set_inner(Whitelist {
            addresses: vec![default_address],
        });

        factory.token_count = token_count.checked_add(1).unwrap();

        // Create metadata account using Metaplex
        let data_v2 = DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        let create_metadata_accounts_v3_ix = CreateMetadataAccountV3 {
            metadata: ctx.accounts.metadata.key(),
            mint: ctx.accounts.mint.key(),
            mint_authority: ctx.accounts.authority.key(),
            payer: ctx.accounts.authority.key(),
            update_authority: (ctx.accounts.authority.key(), true),
            system_program: ctx.accounts.system_program.key(),
            rent: Some(ctx.accounts.rent.key()),
        };

        let instruction = create_metadata_accounts_v3_ix.instruction(
            CreateMetadataAccountV3InstructionArgs {
                data: data_v2,
                is_mutable: true,
                collection_details: None,
            }
        );

        invoke(
            &instruction,
            &[
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // Create the associated token account manually
        let create_ata_ix = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account(
            &ctx.accounts.authority.key(),
            &ctx.accounts.authority.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.token_program.key(),
        );

        invoke(
            &create_ata_ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.recipient_token_account.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // Mint initial supply to the recipient token account
        if total_supply > 0 {
            mint_to(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                total_supply,
            )?;
            msg!("Minted {} tokens to recipient", total_supply);
        }
        
        Ok(())
    }

    pub fn add_to_whitelist(
        ctx: Context<AddToWhitelistCTX>,
        _token_count: u64,
        addresses: Vec<Pubkey>,
    ) -> Result<()> {
        ctx.accounts.whitelist.addresses.extend(addresses);
        Ok(())
    }

    pub fn get_whitelist(ctx: Context<GetWhitelistCTX>, _token_count: u64) -> Result<()> {
        for addr in &ctx.accounts.whitelist.addresses {
            msg!("{}", addr);
        }
        Ok(())
    }

    pub fn transfer_token(ctx: Context<TransferCTX>, _token_count: u64, amount: u64) -> Result<()> {
        require!(!ctx.accounts.token_data.is_paused, ErrorCode::TokenPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts
                .whitelist
                .addresses
                .contains(&ctx.accounts.to.owner),
            ErrorCode::AddressNotWhitelisted
        );

        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Transferred {} tokens", amount);
        Ok(())
    }

    pub fn mint_tokens(ctx: Context<MintTokensCTX>, _token_count: u64, amount: u64) -> Result<()> {
        require!(
            !ctx.accounts.token_data.is_minting_paused,
            ErrorCode::MintingPaused
        );

        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.token_data.total_supply = ctx
            .accounts
            .token_data
            .total_supply
            .checked_add(amount)
            .unwrap();
        Ok(())
    }

    pub fn burn_tokens(ctx: Context<BurnTokensCTX>, _token_count: u64, amount: u64) -> Result<()> {
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.from.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.token_data.total_supply = ctx
            .accounts
            .token_data
            .total_supply
            .checked_sub(amount)
            .unwrap();
        Ok(())
    }

    pub fn pause_minting(ctx: Context<PauseMintingCTX>, _token_count: u64) -> Result<()> {
        ctx.accounts.token_data.is_minting_paused = !ctx.accounts.token_data.is_minting_paused;
        Ok(())
    }
}

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

#[account]
pub struct TokenFactory {
    pub authority: Pubkey, // 32
    pub token_count: u64,  // 8
}

#[derive(Accounts)]
#[instruction(decimals: u8)]
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
        mint::decimals = decimals,
        mint::authority = authority,
        mint::freeze_authority = authority
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: We're about to create this with Metaplex
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: This will be created via CPI to associated token program
    #[account(mut)]
    pub recipient_token_account: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    #[account(address = anchor_spl::associated_token::ID)]
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(address = anchor_lang::solana_program::sysvar::rent::ID)]
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: This is the Metaplex token metadata program
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

#[account]
pub struct Whitelist {
    pub addresses: Vec<Pubkey>,
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
pub struct TransferCTX<'info> {
    /// CHECK: Authority check done via seeds
    pub factory_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"token", factory_authority.key().as_ref(), &token_count.to_le_bytes()],
        bump,
        constraint = token_data.authority == factory_authority.key()
    )]
    pub token_data: Account<'info, TokenData>,

    #[account(address = token_data.whitelist)]
    pub whitelist: Account<'info, Whitelist>,

    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
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

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
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

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
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
