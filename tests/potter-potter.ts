import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert } from "chai";
import { PotterPotter } from "../target/types/potter_potter";

describe("potter-potter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PotterPotter as Program<PotterPotter>;
  const authority = provider.wallet as anchor.Wallet;

  let factory: PublicKey;
  let tokenData: PublicKey;
  let whitelist: PublicKey;
  let mint: Keypair;

  it("Creates a new factory", async () => {
    [factory] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("token-factory")],
      program.programId
    );

    await program.methods
      .createFactory()
      .accounts({
        factory,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    assert.equal(
      factoryAccount.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.equal(factoryAccount.tokenCount.toNumber(), 0);
  });

  it("Creates a new token", async () => {
    const factoryAccountBefore = await program.account.tokenFactory.fetch(
      factory
    );
    const tokenCount = factoryAccountBefore.tokenCount.toNumber();

    [tokenData] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("token-data"),
        new anchor.BN(tokenCount).toBuffer("le", 8),
      ],
      program.programId
    );

    [whitelist] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("whitelist"),
        new anchor.BN(tokenCount).toBuffer("le", 8),
      ],
      program.programId
    );

    mint = Keypair.generate();
    const defaultAddress = Keypair.generate().publicKey;

    await program.methods
      .createToken(
        new anchor.BN(1000),
        6,
        "Test Token",
        "TEST",
        "http://test.com",
        defaultAddress
      )
      .accounts({
        factory,
        tokenData,
        whitelist,
        mint: mint.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })

      .signers([mint])
      .rpc();

    const factoryAccountAfter = await program.account.tokenFactory.fetch(
      factory
    );
    const tokenDataAccount = await program.account.tokenData.fetch(tokenData);
    const whitelistAccount = await program.account.whitelist.fetch(whitelist);

    assert.equal(factoryAccountAfter.tokenCount.toNumber(), tokenCount + 1);
    assert.equal(
      tokenDataAccount.authority.toBase58(),
      authority.publicKey.toBase58()
    );
    assert.equal(tokenDataAccount.totalSupply.toNumber(), 1000);
    assert.isFalse(tokenDataAccount.isPaused);
    assert.isFalse(tokenDataAccount.isMintingPaused);
    assert.equal(tokenDataAccount.name, "Test Token");
    assert.equal(tokenDataAccount.symbol, "TEST");
    assert.equal(tokenDataAccount.uri, "http://test.com");
    assert.equal(
      whitelistAccount.addresses[0].toBase58(),
      defaultAddress.toBase58()
    );
  });

  it("Adds to whitelist", async () => {
    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    const tokenCount = factoryAccount.tokenCount.toNumber() - 1;

    const newAddress1 = Keypair.generate().publicKey;
    const newAddress2 = Keypair.generate().publicKey;

    await program.methods
      .addToWhitelist(new anchor.BN(tokenCount), [newAddress1, newAddress2])
      .accounts({
        tokenData,
        whitelist,
        authority: authority.publicKey,
      })
      .rpc();

    const whitelistAccount = await program.account.whitelist.fetch(whitelist);
    assert.isTrue(
      whitelistAccount.addresses.some(
        (addr) => addr.toBase58() === newAddress1.toBase58()
      )
    );
    assert.isTrue(
      whitelistAccount.addresses.some(
        (addr) => addr.toBase58() === newAddress2.toBase58()
      )
    );
  });

  it("Transfers tokens", async () => {
    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    const tokenCount = factoryAccount.tokenCount.toNumber() - 1;

    const fromAta = await getAssociatedTokenAddress(
      mint.publicKey,
      authority.publicKey
    );
    const toKp = Keypair.generate();
    const toAta = await getAssociatedTokenAddress(
      mint.publicKey,
      toKp.publicKey
    );

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        fromAta,
        authority.publicKey,
        mint.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        toAta,
        toKp.publicKey,
        mint.publicKey
      )
    );
    await provider.sendAndConfirm(tx, []);

    await program.methods
      .mintTokens(new anchor.BN(tokenCount), new anchor.BN(100))
      .accounts({
        tokenData,
        mint: mint.publicKey,
        to: fromAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .addToWhitelist(new anchor.BN(tokenCount), [toAta])
      .accounts({
        tokenData,
        whitelist,
        authority: authority.publicKey,
      })
      .rpc();

    await program.methods
      .transferToken(new anchor.BN(tokenCount), new anchor.BN(50))
      .accounts({
        tokenData,
        whitelist,
        from: fromAta,
        to: toAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const toAtaAccount = await provider.connection.getTokenAccountBalance(
      toAta
    );
    assert.equal(toAtaAccount.value.amount, "50");
  });

  it("Mints tokens", async () => {
    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    const tokenCount = factoryAccount.tokenCount.toNumber() - 1;

    const toAta = await getAssociatedTokenAddress(
      mint.publicKey,
      authority.publicKey
    );

    const initialSupply = (await program.account.tokenData.fetch(tokenData))
      .totalSupply;

    await program.methods
      .mintTokens(new anchor.BN(tokenCount), new anchor.BN(100))
      .accounts({
        tokenData,
        mint: mint.publicKey,
        to: toAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const newSupply = (await program.account.tokenData.fetch(tokenData))
      .totalSupply;
    assert.equal(newSupply.toNumber(), initialSupply.toNumber() + 100);
  });

  it("Burns tokens", async () => {
    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    const tokenCount = factoryAccount.tokenCount.toNumber() - 1;

    const fromAta = await getAssociatedTokenAddress(
      mint.publicKey,
      authority.publicKey
    );

    const initialSupply = (await program.account.tokenData.fetch(tokenData))
      .totalSupply;

    await program.methods
      .burnTokens(new anchor.BN(tokenCount), new anchor.BN(50))
      .accounts({
        tokenData,
        mint: mint.publicKey,
        from: fromAta,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const newSupply = (await program.account.tokenData.fetch(tokenData))
      .totalSupply;
    assert.equal(newSupply.toNumber(), initialSupply.toNumber() - 50);
  });

  it("Pauses and unpauses minting", async () => {
    const factoryAccount = await program.account.tokenFactory.fetch(factory);
    const tokenCount = factoryAccount.tokenCount.toNumber() - 1;

    // Pause
    await program.methods
      .pauseMinting(new anchor.BN(tokenCount))
      .accounts({
        tokenData,
        authority: authority.publicKey,
      })
      .rpc();

    let tokenDataAccount = await program.account.tokenData.fetch(tokenData);
    assert.isTrue(tokenDataAccount.isMintingPaused);

    // Unpause
    await program.methods
      .pauseMinting(new anchor.BN(tokenCount))
      .accounts({
        tokenData,
        authority: authority.publicKey,
      })
      .rpc();

    tokenDataAccount = await program.account.tokenData.fetch(tokenData);
    assert.isFalse(tokenDataAccount.isMintingPaused);
  });
});