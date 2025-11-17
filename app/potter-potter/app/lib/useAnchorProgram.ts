import { useMemo } from "react";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import idl from "./idl.json";

export function useAnchorProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const provider = useMemo(() => {
    if (wallet) {
      console.log("Wallet detected, creating provider.");
      return new AnchorProvider(connection, wallet, {
        preflightCommitment: "processed",
      });
    }
    console.log("Wallet not detected, provider is null.");
    return null;
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (provider) {
      console.log("Provider detected, attempting to create program.");
      if (
        !idl ||
        !idl.metadata ||
        !idl.metadata.version ||
        !idl.instructions ||
        !idl.accounts
      ) {
        console.error("Invalid IDL structure:", idl);
        return null;
      }
      const programInstance = new Program<PotterPotter>(idl, provider);
      console.log("Program instance after creation:", programInstance);
      console.log("Program created successfully.");
      return programInstance;
    }
    console.log("Provider not detected, program is null.");
    return null;
  }, [provider]);

  return { program, provider, connection };
}
