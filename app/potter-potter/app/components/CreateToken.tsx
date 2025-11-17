import React, { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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
  const [displayRawSupply, setDisplayRawSupply] = useState("0");
  const [rawSupplyExceedsU64Max, setRawSupplyExceedsU64Max] = useState(false);

  const METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );

  const U64_MAX = BigInt("18446744073709551615"); // 2^64 - 1

  useEffect(() => {
    try {
      const raw = new anchor.BN(totalSupply).mul(
        new anchor.BN(10).pow(new anchor.BN(decimals)),
      );
      setDisplayRawSupply(raw.toString());
      setRawSupplyExceedsU64Max(raw.toBigInt() > U64_MAX);
    } catch {
      setDisplayRawSupply("Invalid input");
      setRawSupplyExceedsU64Max(true);
    }
  }, [totalSupply, decimals]);

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
      console.log("=== START ===");

      // --- MINT ---
      const mint = Keypair.generate();

      // --- FACTORY ---
      const [factory] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId,
      );

      const factoryAcc = await program.account.tokenFactory.fetch(factory);

      // --- TOKEN DATA PDA ---
      const [tokenData] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAcc.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );

      // --- WHITELIST PDA ---
      const [whitelist] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("whitelist"),
          publicKey.toBuffer(),
          new anchor.BN(factoryAcc.tokenCount).toBuffer("le", 8),
        ],
        program.programId,
      );

      // --- METADATA PDA ---
      const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mint.publicKey.toBuffer(),
        ],
        METADATA_PROGRAM_ID,
      );

      // --- ASSOCIATED TOKEN ACCOUNT ---
      const ata = getAssociatedTokenAddressSync(mint.publicKey, publicKey);

      const rawSupply = new anchor.BN(totalSupply).mul(
        new anchor.BN(10).pow(new anchor.BN(decimals)),
      );

      const signers = [mint];

      console.log("PublicKey before RPC:", publicKey ? publicKey.toBase58() : "undefined");
      console.log("Mint signer:", mint.publicKey.toBase58());

      // --- SEND TX ---
      const tx = await program.methods
        .createToken(rawSupply, decimals, name, symbol, uri, defaultPk)
        .accounts({
          factory,
          tokenData,
          whitelist,
          mint: mint.publicKey,
          metadata,
          ata,
          authority: publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: METADATA_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers(signers)
        .rpc();

      setSignature(tx);
    } catch (err: any) {
      console.log(err);
      setError(err.message || "Transaction failed");
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
            Total Supply (Human-Readable)
          </label>
          <input
            type="number"
            id="totalSupply"
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={totalSupply}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!isNaN(value)) {
                setTotalSupply(value);
              }
            }}
            required
            min="1"
          />
          <p className="text-xs text-gray-400 mt-1">
            Raw Supply (for program): {displayRawSupply}
          </p>
          {rawSupplyExceedsU64Max && (
            <p className="text-xs text-red-400 mt-1">
              Warning: Raw supply exceeds maximum allowed for u64 and will cause an error on-chain. Please reduce total supply or decimals.
            </p>
          )}
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
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!isNaN(value)) {
                setDecimals(value);
              }
            }}
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
          disabled={isLoading || !program || !publicKey || rawSupplyExceedsU64Max}
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
