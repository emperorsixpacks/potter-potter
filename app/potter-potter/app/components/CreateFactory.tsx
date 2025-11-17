import React, { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorProgram } from "../lib/useAnchorProgram";

export function CreateFactory({
  onFactoryCreated,
}: {
  onFactoryCreated?: (factory: any) => void;
}) {
  const { program, connection } = useAnchorProgram();
  const { publicKey } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [factoryExists, setFactoryExists] = useState<boolean | null>(null);
  const [factoryAddress, setFactoryAddress] = useState<string | null>(null);

  useEffect(() => {
    checkFactory();
  }, [program, publicKey]);

  const checkFactory = async () => {
    if (!program || !publicKey) return;

    try {
      const [factory] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId,
      );
      
      setFactoryAddress(factory.toBase58());
      console.log("Factory address:", factory.toBase58());

      try {
        const factoryAccount = await program.account.tokenFactory.fetch(factory);
        console.log("Factory exists! Token count:", factoryAccount.tokenCount.toString());
        setFactoryExists(true);
      } catch (e) {
        console.log("Factory does not exist yet");
        setFactoryExists(false);
      }
    } catch (e) {
      console.error("Error checking factory:", e);
    }
  };

  const createFactory = async () => {
    if (!program || !publicKey || !connection) {
      setError("Program, wallet, or connection not initialized");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSignature(null);

    try {
      console.log("=== Creating Factory ===");
      console.log("Program ID:", program.programId.toBase58());
      console.log("Authority:", publicKey.toBase58());
      
      const [factory] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId,
      );

      console.log("Factory PDA:", factory.toBase58());

      // Check if factory already exists
      try {
        const existingFactory = await program.account.tokenFactory.fetch(factory);
        console.log("Factory already exists:", existingFactory);
        setError("Factory already exists for this wallet!");
        setFactoryExists(true);
        setIsLoading(false);
        return;
      } catch (e) {
        // Factory doesn't exist, continue
        console.log("Factory doesn't exist, creating new one...");
      }

      // Use .rpc() instead of .transaction() + sendTransaction
      const tx = await program.methods
        .createFactory()
        .accounts({
          factory,
          authority: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Transaction signature:", tx);
      setSignature(tx);
      setFactoryExists(true);

      // Wait a bit for the transaction to confirm
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch the created factory
      try {
        const factoryAccount = await program.account.tokenFactory.fetch(factory);
        console.log("Factory created successfully:", factoryAccount);
        if (onFactoryCreated) {
          onFactoryCreated(factoryAccount);
        }
      } catch (e) {
        console.error("Error fetching factory after creation:", e);
      }

    } catch (e: any) {
      console.error("=== Error Creating Factory ===");
      console.error("Error:", e);
      console.error("Error message:", e.message);
      
      if (e.logs) {
        console.error("Transaction logs:", e.logs);
      }

      let errorMessage = e.message;
      
      // Parse common errors
      if (e.message.includes("already in use")) {
        errorMessage = "Factory already exists for this wallet!";
        setFactoryExists(true);
      } else if (e.message.includes("insufficient funds")) {
        errorMessage = "Insufficient SOL balance. You need at least 0.01 SOL.";
      } else if (e.message.includes("User rejected")) {
        errorMessage = "Transaction cancelled by user.";
      } else if (e.message.includes("Attempt to debit an account but found no record")) {
        errorMessage = "Account not found. Make sure you have SOL in your wallet.";
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
      <h2 className="text-2xl font-bold mb-4 text-white">Token Factory</h2>
      
      {/* Status Display */}
      <div className="mb-4 p-3 bg-gray-700 rounded">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">Status:</span>
          {factoryExists === null ? (
            <span className="text-gray-400">Checking...</span>
          ) : factoryExists ? (
            <span className="text-green-400 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Active
            </span>
          ) : (
            <span className="text-yellow-400 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Not Created
            </span>
          )}
        </div>
        
        {factoryAddress && (
          <div className="text-xs text-gray-400 break-all">
            <span className="font-medium">Address:</span> {factoryAddress}
          </div>
        )}
      </div>

      {/* Info Box */}
      {!factoryExists && factoryExists !== null && (
        <div className="mb-4 p-3 bg-blue-900 bg-opacity-30 border border-blue-600 rounded">
          <p className="text-blue-200 text-sm">
            <strong>First time setup:</strong> Create a factory to manage your tokens. This is a one-time operation.
          </p>
        </div>
      )}

      {/* Create Button */}
      <button
        onClick={createFactory}
        className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isLoading || !program || !publicKey || factoryExists === true}
      >
        {isLoading
          ? "Creating Factory..."
          : !program || !publicKey
            ? "Connect Wallet"
            : factoryExists
              ? "✓ Factory Already Created"
              : "Create Factory"}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-4 p-3 bg-red-900 bg-opacity-50 border border-red-500 rounded">
          <p className="text-red-200 text-sm font-medium mb-1">Error:</p>
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}
      
      {/* Success Display */}
      {signature && (
        <div className="mt-4 p-3 bg-green-900 bg-opacity-50 border border-green-500 rounded">
          <p className="text-green-200 text-sm font-medium mb-2">
            Factory created successfully! ✓
          </p>
          <a
            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-300 text-sm underline hover:text-green-100"
          >
            View transaction on Solana Explorer →
          </a>
        </div>
      )}
    </div>
  );
}
