import React, { useEffect, useState } from "react";
import type { Route } from "./+types/home";
import { WalletButton } from "../components/WalletButton";
import { CreateFactory } from "../components/CreateFactory";
import { CreateToken } from "../components/CreateToken";
import { TokenList } from "../components/TokenList";
import { ClientOnly } from "../components/ClientOnly";
import { useAnchorProgram } from "../lib/useAnchorProgram";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Potter Potter DApp" },
    { name: "description", content: "Solana Token Factory DApp" },
  ];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<
    "createFactory" | "createToken" | "tokenList"
  >("createFactory");
  const { program } = useAnchorProgram();
  const { publicKey } = useWallet();
  const [factory, setFactory] = useState<any>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (program && publicKey) {
      const findFactory = async () => {
        setLoading(true);
        try {
          const [factoryAddress] = await PublicKey.findProgramAddress(
            [Buffer.from("factory"), publicKey.toBuffer()],
            program.programId
          );
          const factoryAccount = await program.account.tokenFactory.fetch(
            factoryAddress
          );
          setFactory(factoryAccount);
          setActiveTab("tokenList"); // Default to token list if factory exists
        } catch (error) {
          console.log("No factory found for this user.");
          setFactory(null);
          setActiveTab("createFactory");
        } finally {
          setLoading(false);
        }
      };
      findFactory();
    } else {
      setLoading(false);
    }
  }, [program, publicKey]);

  const handleFactoryCreated = (newFactory: any) => {
    setFactory(newFactory);
    setActiveTab("createToken");
  };

  if (loading) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900 text-white">
        <p>Loading factory...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-900 text-white">
      <div className="mb-8">
        <WalletButton />
      </div>

      <div className="w-full max-w-4xl mx-auto">
        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("createFactory")}
              className={`${
                activeTab === "createFactory"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
              //disabled={!!factory}
            >
              Create Factory
            </button>
            <button
              onClick={() => setActiveTab("createToken")}
              className={`${
                activeTab === "createToken"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={!factory}
            >
              Create Token
            </button>
            <button
              onClick={() => setActiveTab("tokenList")}
              className={`${
                activeTab === "tokenList"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={!factory}
            >
              Token List
            </button>
          </nav>
        </div>

        <div className="mt-8">
          {activeTab === "createFactory" && (
            <ClientOnly>
              <CreateFactory onFactoryCreated={handleFactoryCreated} />
            </ClientOnly>
          )}
          {activeTab === "createToken" && (
            <ClientOnly>
              <CreateToken />
            </ClientOnly>
          )}
          {activeTab === "tokenList" && (
            <ClientOnly>
              <TokenList />
            </ClientOnly>
          )}
        </div>
      </div>
    </main>
  );
}
