use anchor_lang::prelude::error_code;

#[error_code]
pub enum ErrorCode {
    #[msg("Token transfers are currently paused")]
    TokenPaused,

    #[msg("Invalid amount specified")]
    InvalidAmount,

    #[msg("Unauthorized: only token authority can perform this action")]
    Unauthorized,

    #[msg("Maximum supply exceeded")]
    MaxSupplyExceeded,

    #[msg("Symbol name too long")]
    SymbolTooLong,

    #[msg("Name too long")]
    NameTooLong,

    #[msg("Address not whitelisted")]
    AddressNotWhitelisted,

    #[msg("Minting is currently paused")]
    MintingPaused,

    #[msg("Invalid metadata account")]
    InvalidMetadataAccount,
}
