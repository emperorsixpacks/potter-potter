import React, { useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "../lib/useAnchorProgram";

export function CreateToken() {
  const { program } = useAnchorProgram();
  const { publicKey } = useWallet();
  const [totalSupply, setTotalSupply] = useState(1000);
  const [decimals, setDecimals] = useState(9);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [defaultAddress, setDefaultAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const createToken = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!program || !publicKey) {
      setError("Program or wallet not initialized");
      return;
    }

    // Validate default address
    try {
      new PublicKey(defaultAddress);
    } catch (e) {
      setError("Invalid Default Whitelisted Address");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSignature(null);

    try {
      console.log("=== Starting Token Creation ===");
      console.log("Program ID:", program.programId.toBase58());
      console.log("Authority:", publicKey.toBase58());

      const mint = Keypair.generate();
      console.log("Generated Mint:", mint.publicKey.toBase58());

      const [factory] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId,
      );
      console.log("Factory PDA:", factory.toBase58());

      // Fetch factory account
      let factoryAccount;
      try {
        factoryAccount = await program.account.tokenFactory.fetch(factory);
        console.log(
          "Factory Token Count:",
          factoryAccount.tokenCount.toString(),
        );
      } catch (e) {
        setError(
          "Factory account not found. Please create a factory first by calling create_factory.",
        );
        setIsLoading(false);
        return;
      }

      const [tokenData] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAccount.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );
      console.log("Token Data PDA:", tokenData.toBase58());

      const [whitelist] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("whitelist"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAccount.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );
      console.log("Whitelist PDA:", whitelist.toBase58());

      const METADATA_PROGRAM_ID = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      );

      const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID,
      );
      console.log("Metadata PDA:", metadata.toBase58());

      const supplyWithDecimals = new anchor.BN(totalSupply).mul(
        new anchor.BN(10).pow(new anchor.BN(decimals)),
      );
      console.log(
        "Total Supply (with decimals):",
        supplyWithDecimals.toString(),
      );

      const recipientTokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        publicKey,
      );
      console.log("Recipient Token Account:", recipientTokenAccount.toBase58());

      console.log("\n=== Building Transaction ===");
      // CRITICAL: Account order MUST match CreateTokenCTX in Rust EXACTLY
      // Order: factory, tokenData, whitelist, mint, metadata, authority,
      //        recipientTokenAccount, systemProgram, tokenProgram,
      //        associatedTokenProgram, rent, tokenMetadataProgram

      // Use the exact addresses you provided
      const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
      const TOKEN_PROGRAM = new PublicKey(
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      );
      const RENT_SYSVAR = new PublicKey(
        "SysvarRent111111111111111111111111111111111",
      );
      const METADATA_PROGRAM = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
      );

      // Your accounts object matching Rust order
      const accounts = {
        factory, // Account<TokenFactory>
        tokenData, // Account<TokenData>
        whitelist, // Account<Whitelist>
        mint: mint.publicKey, // Account<Mint>
        metadata, // UncheckedAccount
        authority: publicKey, // Signer
        recipientTokenAccount, // UncheckedAccount
        systemProgram: SYSTEM_PROGRAM, // PublicKey
        tokenProgram: TOKEN_PROGRAM, // PublicKey
        associatedTokenProgram: new PublicKey(
          "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        ), // official SPL Associated Token Program
        rent: RENT_SYSVAR, // PublicKey
        tokenMetadataProgram: METADATA_PROGRAM, // PublicKey
      };
      console.log(
        "Accounts:",
        JSON.stringify(
          {
            factory: accounts.factory.toBase58(),
            tokenData: accounts.tokenData.toBase58(),
            whitelist: accounts.whitelist.toBase58(),
            mint: accounts.mint.toBase58(),
            metadata: accounts.metadata.toBase58(),
            authority: accounts.authority.toBase58(),
            recipientTokenAccount: accounts.recipientTokenAccount.toBase58(),
            systemProgram: accounts.systemProgram.toBase58(),
            tokenProgram: accounts.tokenProgram.toBase58(),
            associatedTokenProgram: accounts.associatedTokenProgram.toBase58(),
            rent: accounts.rent.toBase58(),
            tokenMetadataProgram: accounts.tokenMetadataProgram.toBase58(),
          },
          null,
          2,
        ),
      );

      console.log("\n=== Sending Transaction ===");
      const tx = await program.methods
        .createToken(
          supplyWithDecimals,
          decimals,
          name,
          symbol,
          uri,
          new PublicKey(defaultAddress),
        )
        .accounts(accounts)
        .signers([mint])
        .rpc({ skipPreflight: false });

      console.log("Transaction Signature:", tx);
      setSignature(tx);
    } catch (e: any) {
      console.error("=== Error Details ===");
      console.error("Error:", e);
      console.error("Error Message:", e.message);

      if (e.logs) {
        console.error("Transaction Logs:", e.logs);
      }

      // More user-friendly error messages
      let errorMessage = e.message;

      if (e.message.includes("AccountNotInitialized")) {
        errorMessage =
          "Account not initialized. This might be a program deployment issue.";
      } else if (e.message.includes("factory")) {
        errorMessage = "Factory not found. Please create a factory first.";
      } else if (e.message.includes("insufficient funds")) {
        errorMessage = "Insufficient SOL balance to complete transaction.";
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
      <h2 className="text-2xl font-bold mb-4 text-white">Create Token</h2>
      <form onSubmit={createToken}>
        <div className="mb-4">
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-300"
          >
            Name
          </label>
          <input
            type="text"
            id="name"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={32}
            placeholder="e.g., My Token"
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="symbol"
            className="block text-sm font-medium text-gray-300"
          >
            Symbol
          </label>
          <input
            type="text"
            id="symbol"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            maxLength={10}
            placeholder="e.g., MTK"
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="uri"
            className="block text-sm font-medium text-gray-300"
          >
            URI (Metadata URL)
          </label>
          <input
            type="text"
            id="uri"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            required
            maxLength={100}
            placeholder="https://..."
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="totalSupply"
            className="block text-sm font-medium text-gray-300"
          >
            Total Supply
          </label>
          <input
            type="number"
            id="totalSupply"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={totalSupply}
            onChange={(e) => setTotalSupply(Number(e.target.value))}
            required
            min="1"
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="decimals"
            className="block text-sm font-medium text-gray-300"
          >
            Decimals
          </label>
          <input
            type="number"
            id="decimals"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={decimals}
            onChange={(e) => setDecimals(Number(e.target.value))}
            required
            min="0"
            max="9"
          />
        </div>
        <div className="mb-4">
          <label
            htmlFor="defaultAddress"
            className="block text-sm font-medium text-gray-300"
          >
            Default Whitelisted Address
          </label>
          <input
            type="text"
            id="defaultAddress"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={defaultAddress}
            onChange={(e) => setDefaultAddress(e.target.value)}
            required
            placeholder="Solana wallet address"
          />
        </div>
        <button
          type="submit"
          className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isLoading || !program || !publicKey}
        >
          {isLoading
            ? "Creating..."
            : !program || !publicKey
              ? "Connect Wallet to Create Token"
              : "Create Token"}
        </button>
      </form>
      {error && (
        <div className="mt-4 p-3 bg-red-900 bg-opacity-50 border border-red-500 rounded">
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}
      {signature && (
        <div className="mt-4 p-3 bg-green-900 bg-opacity-50 border border-green-500 rounded">
          <p className="text-green-200 text-sm">
            Success!{" "}
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              View on Explorer
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
