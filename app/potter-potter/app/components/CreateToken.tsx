import React, { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "../lib/useAnchorProgram";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export function CreateToken() {
  const { program } = useAnchorProgram();
  const { publicKey } = useWallet();

  const [totalSupply, setTotalSupply] = useState(1000);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri, setUri] = useState("");
  const [defaultAddress, setDefaultAddress] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Set default whitelist address to current user's wallet when it becomes available
  useEffect(() => {
    if (publicKey && !defaultAddress) {
      setDefaultAddress(publicKey.toBase58());
    }
  }, [publicKey, defaultAddress]);

  const createToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!program || !publicKey) return;

    // Validate whitelist
    let defaultPk: PublicKey;
    try {
      defaultPk = new PublicKey(defaultAddress);
    } catch {
      return setError("Invalid default whitelist address");
    }

    setError(null);
    setSignature(null);
    setIsLoading(true);

    try {
      console.log("=== START CREATE TOKEN ===");

      // --- MINT ---
      const mint = Keypair.generate();
      console.log("Mint:", mint.publicKey.toBase58());

      // --- FACTORY ---
      const [factory] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId,
      );
      console.log("Factory:", factory.toBase58());

      const factoryAcc = await program.account.tokenFactory.fetch(factory);
      console.log("Token Count:", factoryAcc.tokenCount.toString());

      // --- TOKEN DATA PDA ---
      const [tokenData] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAcc.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );
      console.log("Token Data:", tokenData.toBase58());

      // --- WHITELIST PDA ---
      const [whitelist] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("whitelist"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAcc.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );
      console.log("Whitelist:", whitelist.toBase58());

      // --- MINT AUTHORITY PDA ---
      const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority"), publicKey.toBuffer()],
        program.programId,
      );
      console.log("Mint Authority PDA:", mintAuthorityPda.toBase58());

      // --- METADATA PDA ---
      const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID,
      );
      console.log("Metadata:", metadata.toBase58());

      // --- ASSOCIATED TOKEN ACCOUNT (Token-2022) ---
      const ata = getAssociatedTokenAddressSync(
        mint.publicKey,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      console.log("ATA:", ata.toBase58());

      // Use the human-readable total supply directly
      const supplyBN = new anchor.BN(totalSupply);
      console.log("Total Supply (human-readable):", supplyBN.toString());

      const signers = [mint];

      console.log("Authority:", publicKey.toBase58());
      console.log("Default Whitelist Address:", defaultPk.toBase58());

      // --- SEND TX ---
      const tx = await program.methods
        .createToken(supplyBN, name, symbol, uri, defaultPk)
        .accounts({
          factory,
          tokenData,
          whitelist,
          mint: mint.publicKey,
          mintAuthorityPda,
          ata,
          metadata,
          authority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers(signers)
        .rpc();

      console.log("Transaction signature:", tx);
      setSignature(tx);
    } catch (err: any) {
      console.error("Error creating token:", err);

      // Parse error message
      let errorMessage = err.message || "Transaction failed";

      if (err.logs) {
        const customErrorRegex =
          /Program log: custom program error: 0x([0-9a-f]+)/;
        const anchorErrorRegex =
          /Program log: AnchorError.*Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*)/;

        for (const log of err.logs) {
          const customMatch = log.match(customErrorRegex);
          if (customMatch) {
            const errorCode = parseInt(customMatch[1], 16);
            const customErrorIndex = errorCode - 0x1770;
            switch (customErrorIndex) {
              case 0:
                errorMessage = "Token transfers are currently paused.";
                break;
              case 1:
                errorMessage = "Invalid amount specified.";
                break;
              case 2:
                errorMessage =
                  "Unauthorized: only token authority can perform this action.";
                break;
              case 3:
                errorMessage = "Maximum supply exceeded.";
                break;
              case 4:
                errorMessage = "Symbol name too long (max 10 characters).";
                break;
              case 5:
                errorMessage = "Name too long (max 32 characters).";
                break;
              case 6:
                errorMessage = "Address not whitelisted for transfers.";
                break;
              case 7:
                errorMessage = "Minting is currently paused.";
                break;
              case 8:
                errorMessage = "Invalid metadata account.";
                break;
              case 9:
                errorMessage = "URI too long (max 200 characters).";
                break;
              case 10:
                errorMessage = "Is not currently transferring.";
                break;
              default:
                errorMessage = `Unknown custom program error: 0x${customMatch[1]}`;
            }
            break;
          }

          const anchorMatch = log.match(anchorErrorRegex);
          if (anchorMatch) {
            errorMessage = `Program Error: ${anchorMatch[3]} (Code: ${anchorMatch[1]})`;
            break;
          }
        }
      }

      if (err.message.includes("User rejected the request")) {
        errorMessage = "Transaction cancelled by user.";
      } else if (err.message.includes("insufficient funds")) {
        errorMessage = "Insufficient SOL balance for transaction fees.";
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
          <p className="text-xs text-gray-400 mt-1">Max 32 characters</p>
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
          <p className="text-xs text-gray-400 mt-1">Max 10 characters</p>
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
            maxLength={200}
            placeholder="https://..."
          />
          <p className="text-xs text-gray-400 mt-1">Max 200 characters</p>
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
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!isNaN(value) && value > 0) {
                setTotalSupply(value);
              }
            }}
            required
            min="1"
            placeholder="e.g., 1000000"
          />
          <p className="text-xs text-gray-400 mt-1">
            Human-readable amount (decimals handled by contract: 9)
          </p>
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
          <p className="text-xs text-gray-400 mt-1">
            This address will be able to receive tokens
          </p>
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
          <p className="text-red-200 text-sm font-semibold">Error:</p>
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      {signature && (
        <div className="mt-4 p-3 bg-green-900 bg-opacity-50 border border-green-500 rounded">
          <p className="text-green-200 text-sm font-semibold mb-1">
            Token Created Successfully! 🎉
          </p>
          <a
            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-300 text-sm underline hover:text-green-100"
          >
            View Transaction on Solana Explorer →
          </a>
        </div>
      )}

      {isLoading && (
        <div className="mt-4 flex items-center justify-center">
          <svg
            className="animate-spin h-8 w-8 text-indigo-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      )}
    </div>
  );
}
