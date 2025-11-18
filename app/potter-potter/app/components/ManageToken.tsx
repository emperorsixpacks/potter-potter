import React, { useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "../lib/useAnchorProgram";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

interface ManageTokenProps {
  token: any;
  onClose: () => void;
  onTransactionSuccess: () => void;
}

export function ManageToken({
  token,
  onClose,
  onTransactionSuccess,
}: ManageTokenProps) {
  const { program, connection } = useAnchorProgram();
  const { publicKey, sendTransaction } = useWallet();
  const [amountToMint, setAmountToMint] = useState(0);
  const [amountToBurn, setAmountToBurn] = useState(0);
  const [addressesToWhitelist, setAddressesToWhitelist] = useState("");
  const [addressesToRemove, setAddressesToRemove] = useState("");
  const [newAuthority, setNewAuthority] = useState("");
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const getWhitelist = async () => {
    if (!program) return;
    setIsLoading(true);
    setError(null);
    setWhitelist([]);
    try {
      const whitelistAccount = await program.account.whitelist.fetch(
        token.whitelist
      );
      setWhitelist(
        (whitelistAccount.addresses as PublicKey[]).map((addr) =>
          addr.toBase58()
        )
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getOrCreateAssociatedTokenAccount = async (
    owner: PublicKey
  ): Promise<PublicKey> => {
    if (!connection || !publicKey || !sendTransaction)
      throw new Error("Connection or wallet not ready");

    const associatedTokenAddress = await getAssociatedTokenAddress(
      token.mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const account = await connection.getAccountInfo(associatedTokenAddress);

    if (account === null) {
      console.log("Attempting to create ATA for:", owner.toBase58());
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          associatedTokenAddress,
          owner,
          token.mint,
          TOKEN_2022_PROGRAM_ID
        )
      );
      try {
        await sendTransaction(transaction, connection);
        console.log("ATA created successfully for:", owner.toBase58());
      } catch (e) {
        console.error("Error creating ATA for:", owner.toBase58(), e);
        throw e;
      }
    }

    return associatedTokenAddress;
  };

  const handleTransaction = async (
    buildTransaction: () => Promise<Transaction>
  ) => {
    if (!publicKey || !sendTransaction || !connection) {
      setError("Wallet not connected or program not initialized.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSignature(null);

    try {
      const transaction = await buildTransaction();
      const txSignature = await sendTransaction(transaction, connection);
      setSignature(txSignature);
      onTransactionSuccess();
    } catch (e: any) {
      console.error("Transaction Error (handleTransaction):", e);
      let errorMessage = e.message;

      if (e.logs) {
        const customErrorRegex = /Program log: custom program error: 0x([0-9a-f]+)/;
        const anchorErrorRegex = /Program log: AnchorError caused by instruction: .* Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*)/;

        for (const log of e.logs) {
          const customMatch = log.match(customErrorRegex);
          if (customMatch) {
            const errorCode = parseInt(customMatch[1], 16);
            const customErrorIndex = errorCode - 0x1770;
            switch (customErrorIndex) {
              case 0: errorMessage = "Token transfers are currently paused."; break;
              case 1: errorMessage = "Invalid amount specified."; break;
              case 2: errorMessage = "Unauthorized: only token authority can perform this action."; break;
              case 3: errorMessage = "Maximum supply exceeded."; break;
              case 4: errorMessage = "Symbol name too long."; break;
              case 5: errorMessage = "Name too long."; break;
              case 6: errorMessage = "Address not whitelisted for transfers."; break;
              case 7: errorMessage = "Minting is currently paused."; break;
              case 8: errorMessage = "Invalid metadata account."; break;
              case 9: errorMessage = "URI too long."; break;
              case 10: errorMessage = "Is not currently transferring."; break;
              default: errorMessage = `Unknown custom program error: 0x${customMatch[1]}`;
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

      if (e.message.includes("User rejected the request")) {
        errorMessage = "Transaction cancelled by user.";
      } else if (e.message.includes("insufficient funds")) {
        errorMessage = "Insufficient SOL balance for transaction fees.";
      } else if (e.message.includes("Transaction simulation failed")) {
        errorMessage = "Transaction simulation failed. Check console for details.";
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const mintTokens = () =>
    handleTransaction(async () => {
      const toAccount = await getOrCreateAssociatedTokenAccount(publicKey!);
      
      const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority"), publicKey!.toBuffer()],
        program.programId
      );

      console.log("Minting to ATA:", toAccount.toBase58());
      console.log("Token Mint:", token.mint.toBase58());
      console.log("Mint Authority PDA:", mintAuthorityPda.toBase58());
      
      return program.methods
        .mintTokens(
          new anchor.BN(token.token_count),
          new anchor.BN(amountToMint)
        )
        .accounts({
          tokenData: token.tokenDataAddress,
          mint: token.mint,
          to: toAccount,
          mintAuthorityPda: mintAuthorityPda,
          authority: publicKey!,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();
    });

  const burnTokens = () =>
    handleTransaction(async () => {
      const fromAccount = await getOrCreateAssociatedTokenAccount(publicKey!);

      return program.methods
        .burnTokens(
          new anchor.BN(token.token_count),
          new anchor.BN(amountToBurn)
        )
        .accounts({
          tokenData: token.tokenDataAddress,
          mint: token.mint,
          from: fromAccount,
          authority: publicKey!,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .transaction();
    });

  const addToWhitelist = () =>
    handleTransaction(async () => {
      return program.methods
        .addToWhitelist(
          new anchor.BN(token.token_count),
          addressesToWhitelist
            .split(",")
            .map((address) => new PublicKey(address.trim()))
        )
        .accounts({
          tokenData: token.tokenDataAddress,
          whitelist: token.whitelist,
          authority: publicKey!,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .transaction();
    });

  const removeFromWhitelist = () =>
    handleTransaction(async () => {
      return program.methods
        .removeFromWhitelist(
          new anchor.BN(token.token_count),
          addressesToRemove
            .split(",")
            .map((address) => new PublicKey(address.trim()))
        )
        .accounts({
          tokenData: token.tokenDataAddress,
          whitelist: token.whitelist,
          authority: publicKey!,
        })
        .transaction();
    });

  const pauseMinting = () =>
    handleTransaction(async () => {
      return program.methods
        .pauseMinting(new anchor.BN(token.token_count))
        .accounts({
          tokenData: token.tokenDataAddress,
          authority: publicKey!,
        })
        .transaction();
    });

  const pauseToken = () =>
    handleTransaction(async () => {
      return program.methods
        .pauseToken(new anchor.BN(token.token_count))
        .accounts({
          tokenData: token.tokenDataAddress,
          authority: publicKey!,
        })
        .transaction();
    });

  const transferAuthority = () =>
    handleTransaction(async () => {
      return program.methods
        .transferAuthority(
          new anchor.BN(token.token_count),
          new PublicKey(newAuthority)
        )
        .accounts({
          tokenData: token.tokenDataAddress,
          authority: publicKey!,
        })
        .transaction();
    });

  return (
    <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-full max-w-2xl mt-4 relative">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl"
      >
        &times;
      </button>
      <h3 className="text-xl font-bold mb-4 text-white">Manage {token.name}</h3>
      
      <div className="mb-4 p-4 bg-gray-800 rounded-md">
        <p className="text-gray-300 text-sm">
          <strong>Symbol:</strong> {token.symbol}
        </p>
        <p className="text-gray-300 text-sm">
          <strong>Decimals:</strong> {token.decimals}
        </p>
        <p className="text-gray-300 text-sm">
          <strong>Total Supply:</strong> {token.total_supply ? token.total_supply.toString() : "Loading..."}
        </p>
        <p className="text-gray-300 text-sm">
          <strong>Minting:</strong> {token.is_minting_paused ? "Paused" : "Active"}
        </p>
        <p className="text-gray-300 text-sm">
          <strong>Token Status:</strong> {token.is_paused ? "Paused" : "Active"}
        </p>
        <p className="text-gray-300 text-sm break-all">
          <strong>Mint Address:</strong> {token.mint.toBase58()}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Mint */}
        <div>
          <h4 className="text-lg font-semibold text-white">Mint Tokens</h4>
          <input
            type="number"
            value={amountToMint}
            onChange={(e) => setAmountToMint(Number(e.target.value))}
            placeholder="Amount to mint"
            className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Human-readable amount (without decimals)</p>
          <button
            onClick={mintTokens}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mint
          </button>
        </div>

        {/* Burn */}
        <div>
          <h4 className="text-lg font-semibold text-white">Burn Tokens</h4>
          <input
            type="number"
            value={amountToBurn}
            onChange={(e) => setAmountToBurn(Number(e.target.value))}
            placeholder="Amount to burn"
            className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Human-readable amount (without decimals)</p>
          <button
            onClick={burnTokens}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Burn
          </button>
        </div>

        {/* Add to Whitelist */}
        <div className="md:col-span-2">
          <h4 className="text-lg font-semibold text-white">Add to Whitelist</h4>
          <textarea
            value={addressesToWhitelist}
            onChange={(e) => setAddressesToWhitelist(e.target.value)}
            placeholder="Enter addresses, separated by commas"
            className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            rows={3}
          />
          <button
            onClick={addToWhitelist}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add to Whitelist
          </button>
        </div>

        {/* Remove from Whitelist */}
        <div className="md:col-span-2">
          <h4 className="text-lg font-semibold text-white">Remove from Whitelist</h4>
          <textarea
            value={addressesToRemove}
            onChange={(e) => setAddressesToRemove(e.target.value)}
            placeholder="Enter addresses to remove, separated by commas"
            className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            rows={3}
          />
          <button
            onClick={removeFromWhitelist}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Remove from Whitelist
          </button>
        </div>

        {/* Pause Minting */}
        <div>
          <h4 className="text-lg font-semibold text-white">Minting Control</h4>
          <button
            onClick={pauseMinting}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {token.is_minting_paused ? "Resume Minting" : "Pause Minting"}
          </button>
        </div>

        {/* Pause Token */}
        <div>
          <h4 className="text-lg font-semibold text-white">Token Control</h4>
          <button
            onClick={pauseToken}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {token.is_paused ? "Resume Token" : "Pause Token"}
          </button>
        </div>

        {/* Transfer Authority */}
        <div className="md:col-span-2">
          <h4 className="text-lg font-semibold text-white">Transfer Authority</h4>
          <input
            type="text"
            value={newAuthority}
            onChange={(e) => setNewAuthority(e.target.value)}
            placeholder="New authority public key"
            className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
          <button
            onClick={transferAuthority}
            disabled={isLoading || !program || !publicKey}
            className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-800 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Transfer Authority (Careful!)
          </button>
        </div>
      </div>

      {/* Get Whitelist */}
      <div className="mt-6">
        <h4 className="text-lg font-semibold text-white">View Whitelist</h4>
        <button
          onClick={getWhitelist}
          disabled={isLoading || !program || !publicKey}
          className="mt-2 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Get Whitelisted Addresses
        </button>
        {whitelist.length > 0 && (
          <div className="mt-4 p-4 bg-gray-800 rounded-md max-h-60 overflow-y-auto">
            <h5 className="text-md font-semibold text-white mb-2">
              Whitelisted Addresses ({whitelist.length}):
            </h5>
            <ul className="space-y-1">
              {whitelist.map((address, index) => (
                <li key={index} className="text-gray-300 text-sm font-mono break-all">
                  {address}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
          <p className="font-semibold">Error:</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {signature && (
        <div className="mt-4 bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-md">
          <p className="font-semibold">Success! 🎉</p>
          <p className="text-sm mt-1">
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-green-100"
            >
              View on Solana Explorer →
            </a>
          </p>
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
