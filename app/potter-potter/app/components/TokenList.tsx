import React, { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { useAnchorProgram } from "../lib/useAnchorProgram";
import { useWallet } from "@solana/wallet-adapter-react";
import { ManageToken } from "./ManageToken";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export function TokenList() {
  const { program, connection } = useAnchorProgram();
  const { publicKey } = useWallet();
  const [tokens, setTokens] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<any | null>(null);

  const fetchTokens = async () => {
    if (!program || !publicKey || !connection) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setTokens([]);

    try {
      const [factoryAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("factory"), publicKey.toBuffer()],
        program.programId
      );

      const factoryAccount = await program.account.tokenFactory.fetch(
        factoryAddress
      );

      const tokenCount = factoryAccount.tokenCount.toNumber();
      const tokenPromises = [];

      for (let i = 0; i < tokenCount; i++) {
        const [tokenDataAddress] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("token"),
            publicKey.toBuffer(),
            new anchor.BN(i).toBuffer("le", 8),
          ],
          program.programId
        );

        const promise = program.account.tokenData
          .fetch(tokenDataAddress)
          .then((tokenData) => ({
            ...tokenData,
            tokenDataAddress,
            token_count: i,
            factoryAddress: factoryAddress.toBase58(), // Add factoryAddress here
          }))
          .catch((err) => {
            console.error(`Failed to fetch token data for index ${i}:`, err);
            return null; // Return null for failed fetches
          });
        tokenPromises.push(promise);
      }

      const fetchedTokens = (await Promise.all(tokenPromises)).filter(
        (token) => token !== null
      );

      const tokensWithBalances = await Promise.all(
        fetchedTokens.map(async (token) => {
          try {
            const ata = await getAssociatedTokenAddress(token.mint, publicKey);
            const balance = await connection.getTokenAccountBalance(ata);
            return { ...token, balance: balance.value.uiAmountString };
          } catch (error) {
            // ATA doesn't exist or other error, so balance is 0
            return { ...token, balance: "0" };
          }
        })
      );

      setTokens(tokensWithBalances);
    } catch (e: any) {
      if (e instanceof Error && e.message.includes("Account does not exist")) {
        // This is expected if the factory hasn't been created yet.
        setTokens([]);
      } else {
        setError(e.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, [program, publicKey, connection]);

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-4xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">Token List</h2>
        <button
          onClick={fetchTokens}
          className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isLoading || !program || !publicKey}
        >
          {isLoading
            ? "Refreshing..."
            : !program || !publicKey
            ? "Connect Wallet"
            : "Refresh"}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      {tokens.length === 0 && !isLoading && (
        <p className="text-gray-400">No tokens found for this wallet.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tokens.map((token) => (
          <div key={token.mint.toBase58()} className="bg-gray-700 p-4 rounded-lg">
            <h3 className="text-lg font-bold text-white">
              {token.name} ({token.symbol})
            </h3>
            <p className="text-sm text-gray-400 truncate">
              Mint: {token.mint.toBase58()}
            </p>
            <p className="text-sm text-gray-400 truncate">
              Factory: {token.factoryAddress}
            </p>
            <p className="text-sm text-gray-400">
              Total Supply: {token.totalSupply.toString()}
            </p>
            <p className="text-sm text-green-400 font-semibold">
              Your Balance: {
                token.balance && !isNaN(parseFloat(token.balance))
                  ? parseFloat(token.balance).toFixed(3)
                  : "0.000"
              }
            </p>
            <p className="text-sm text-gray-400">Decimals: {token.decimals}</p>
            <button
              onClick={() => setSelectedToken(token)}
              className="mt-4 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Manage
            </button>
          </div>
        ))}
      </div>

      {selectedToken && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-full max-w-2xl">
            <ManageToken
              token={selectedToken}
              onClose={() => {
                setSelectedToken(null);
                fetchTokens();
              }}
              onTransactionSuccess={fetchTokens}
            />
          </div>
        </div>
      )}
    </div>
  );
}