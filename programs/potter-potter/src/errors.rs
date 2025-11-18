use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Name is too long (max 32 characters)")]
    NameTooLong,

    #[msg("Symbol is too long (max 10 characters)")]
    SymbolTooLong,

    #[msg("URI is too long (max 200 characters)")]
    UriTooLong,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Token transfers are paused")]
    TokenPaused,

    #[msg("Token minting is paused")]
    MintingPaused,

    #[msg("Address is not whitelisted")]
    AddressNotWhitelisted,

    #[msg("Transfer hook error: not currently transferring")]
    IsNotCurrentlyTransferring,

    #[msg("Unauthorized")]
    Unauthorized,
}
