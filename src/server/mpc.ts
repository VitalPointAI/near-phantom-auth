/**
 * NEAR MPC Account Manager
 * 
 * Creates NEAR accounts using Chain Signatures MPC network.
 * No private keys are stored - all key management is decentralized.
 */

import { createHash, randomBytes } from 'crypto';
import bs58 from 'bs58';
import BN from 'bn.js';
import pino from 'pino';
import type { Logger } from 'pino';
import { createTransaction, actionCreators } from '@near-js/transactions';
import { KeyPairSigner } from '@near-js/signers';
import { PublicKey, KeyPair } from '@near-js/crypto';
import { parseNearAmount } from '@near-js/utils';
import { checkWalletAccess } from './recovery/wallet.js';

export interface MPCAccount {
  nearAccountId: string;
  derivationPath: string;
  mpcPublicKey: string;
  onChain: boolean;
}

export interface MPCConfig {
  networkId: 'testnet' | 'mainnet';
  accountPrefix?: string;
  treasuryAccount?: string;
  treasuryPrivateKey?: string;
  fundingAmount?: string; // in NEAR, default 0.01
  derivationSalt?: string;
  /** Optional pino logger instance. If omitted, logging is disabled (no output). */
  logger?: Logger;
}

/**
 * Consumer-facing configuration for standalone MPCAccountManager usage (MPC-07).
 * derivationSalt is REQUIRED for cross-tenant isolation. Aliased onto MPCConfig
 * for internal-call backward compatibility.
 */
export interface MPCAccountManagerConfig {
  networkId: 'testnet' | 'mainnet';
  treasuryAccount: string;
  treasuryPrivateKey: string;
  derivationSalt: string;
  fundingAmount?: string;
  logger?: Logger;
}

/**
 * Consumer-facing return type from createAccount(). Alias of MPCAccount for the
 * frozen public contract (MPC-01).
 */
export type CreateAccountResult = MPCAccount;

/**
 * Get the MPC contract ID for a network
 */
function getMPCContractId(networkId: 'testnet' | 'mainnet'): string {
  return networkId === 'mainnet'
    ? 'v1.signer-prod.near'
    : 'v1.signer-prod.testnet';
}

/**
 * Get the RPC URL for a network
 */
function getRPCUrl(networkId: 'testnet' | 'mainnet'): string {
  return networkId === 'mainnet'
    ? 'https://rpc.mainnet.near.org'
    : 'https://rpc.testnet.near.org';
}

/**
 * Derive Ed25519 public key from seed (simplified for account creation)
 */
function derivePublicKey(seed: Buffer): Buffer {
  const hash = createHash('sha512').update(seed).digest();
  return hash.subarray(0, 32);
}

/**
 * Check if NEAR account exists on-chain
 */
async function accountExists(
  accountId: string, 
  networkId: 'testnet' | 'mainnet'
): Promise<boolean> {
  try {
    const rpcUrl = getRPCUrl(networkId);
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'check-account',
        method: 'query',
        params: {
          request_type: 'view_account',
          finality: 'final',
          account_id: accountId,
        },
      }),
    });

    const result = await response.json() as { error?: unknown };
    return !result.error;
  } catch {
    return false;
  }
}

/**
 * Generate a deterministic account name from user ID
 */
function generateAccountName(userId: string, prefix: string): string {
  const hash = createHash('sha256').update(userId).digest('hex');
  const shortHash = hash.substring(0, 12);
  return `${prefix}-${shortHash}`;
}

/**
 * Fund an implicit account from treasury using NEAR RPC
 */
async function fundAccountFromTreasury(
  accountId: string,
  treasuryAccount: string,
  keyPair: KeyPair,
  amountNear: string,
  networkId: 'testnet' | 'mainnet',
  log: Logger
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const nacl = await import('tweetnacl');

  try {
    const rpcUrl = getRPCUrl(networkId);

    // MPC-09: derive secretKey + publicKey from the cached KeyPair object.
    // The raw private-key string never re-appears on this call stack.
    const secretKey: Uint8Array = bs58.decode(keyPair.toString().replace('ed25519:', ''));
    const publicKey = secretKey.length === 64
      ? secretKey.slice(32)
      : nacl.default.sign.keyPair.fromSeed(secretKey.slice(0, 32) as Uint8Array).publicKey;
    
    const publicKeyB58 = bs58.encode(Buffer.from(publicKey));
    const fullPublicKey = `ed25519:${publicKeyB58}`;
    
    log.info({ accountId: treasuryAccount }, 'Treasury public key verified');
    
    // Get access key for nonce and block hash
    const accessKeyResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-access-key',
        method: 'query',
        params: {
          request_type: 'view_access_key',
          finality: 'final',
          account_id: treasuryAccount,
          public_key: fullPublicKey,
        },
      }),
    });
    
    const accessKeyResult = await accessKeyResponse.json() as {
      result?: { nonce: number; block_hash: string };
      error?: { cause?: { name: string }; message?: string };
    };
    
    if (accessKeyResult.error || !accessKeyResult.result) {
      log.error({ err: new Error(JSON.stringify(accessKeyResult.error)) }, 'Access key error');
      return { 
        success: false, 
        error: `Could not get access key: ${accessKeyResult.error?.cause?.name || 'Unknown'}`,
      };
    }
    
    const nonce = accessKeyResult.result.nonce + 1;
    const blockHash = accessKeyResult.result.block_hash;
    
    // Convert NEAR to yoctoNEAR using parseNearAmount from @near-js/utils (MPC-08)
    const yoctoStr = parseNearAmount(amountNear);
    if (!yoctoStr) throw new Error(`Invalid NEAR amount: ${amountNear}`);
    const amountYocto = BigInt(yoctoStr);
    
    // Build transaction manually using borsh serialization
    // Transaction structure: signerId, publicKey, nonce, receiverId, blockHash, actions
    const transaction = buildTransferTransaction(
      treasuryAccount,
      publicKey,
      nonce,
      accountId,
      blockHash,
      amountYocto,
      bs58
    );
    
    // Sign the transaction
    const txHash = createHash('sha256').update(transaction).digest();
    const signature = nacl.default.sign.detached(txHash, secretKey as Uint8Array);
    
    // Build signed transaction
    const signedTx = buildSignedTransaction(transaction, signature, publicKey);
    
    // Submit to RPC
    const submitResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'send-tx',
        method: 'broadcast_tx_commit',
        params: [Buffer.from(signedTx).toString('base64')],
      }),
    });
    
    const submitResult = await submitResponse.json() as {
      result?: { transaction: { hash: string } };
      error?: { data?: string; message?: string };
    };
    
    if (submitResult.error) {
      log.error({ err: new Error(submitResult.error.data || submitResult.error.message || 'Transaction failed') }, 'Transaction error');
      return { 
        success: false, 
        error: submitResult.error.data || submitResult.error.message || 'Transaction failed',
      };
    }
    
    const resultHash = submitResult.result?.transaction?.hash || 'unknown';
    log.info({ accountId, txHash: resultHash }, 'Funded account');
    
    return { success: true, txHash: resultHash };
  } catch (error) {
    log.error({ err: error }, 'Treasury funding failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build a NEAR transfer transaction (borsh serialized)
 */
function buildTransferTransaction(
  signerId: string,
  publicKey: Uint8Array,
  nonce: number,
  receiverId: string,
  blockHash: string,
  amount: bigint,
  bs58: { decode: (str: string) => Uint8Array }
): Uint8Array {
  // Borsh serialize the transaction
  const parts: Uint8Array[] = [];
  
  // signerId (string)
  parts.push(serializeString(signerId));
  
  // publicKey (enum + data) - ED25519 = 0
  parts.push(new Uint8Array([0])); // key type
  parts.push(new Uint8Array(publicKey));
  
  // nonce (u64)
  parts.push(serializeU64(BigInt(nonce)));
  
  // receiverId (string)
  parts.push(serializeString(receiverId));
  
  // blockHash (32 bytes)
  parts.push(bs58.decode(blockHash));
  
  // actions (vec of Action) - single Transfer action
  parts.push(serializeU32(1)); // vec length
  parts.push(new Uint8Array([3])); // Transfer action type
  parts.push(serializeU128(amount)); // amount
  
  return concatArrays(parts);
}

/**
 * Build signed transaction
 */
function buildSignedTransaction(
  transaction: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Transaction bytes
  parts.push(transaction);

  // Signature enum (ED25519 = 0)
  parts.push(new Uint8Array([0]));           // keyType: 1 byte
  parts.push(new Uint8Array(publicKey));     // publicKey: 32 bytes
  parts.push(new Uint8Array(signature));     // signature data: 64 bytes

  return concatArrays(parts);
}

// Borsh serialization helpers
function serializeString(str: string): Uint8Array {
  const bytes = Buffer.from(str, 'utf8');
  const len = serializeU32(bytes.length);
  return concatArrays([len, bytes]);
}

function serializeU32(num: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(num);
  return buf;
}

function serializeU64(num: bigint): Uint8Array {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(num);
  return buf;
}

function serializeU128(num: bigint): Uint8Array {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(num & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
  buf.writeBigUInt64LE(num >> BigInt(64), 8);
  return buf;
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * MPC-06: detect a likely nonce-race broadcast failure.
 * NEAR returns InvalidNonce-class errors when two transfers race for the
 * same nonce. We retry view_account in this case to detect concurrent provisioning.
 */
function isLikelyNonceRace(error?: string): boolean {
  return !!error && /InvalidNonce|nonce|TxAlreadyProcessed/i.test(error);
}

/**
 * MPC-10: detect an RPC-unreachable error from the broadcast result.
 * Used to throw Error('RPC unreachable') with cause set.
 */
function isRpcUnreachable(error?: string): boolean {
  return !!error && /unreachable|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(error);
}

/**
 * MPC-10: detect a treasury-underfunded error from broadcast result.
 * NEAR's stock error message is "Sender does not have enough funds" but
 * we also match "insufficient" defensively.
 */
function isTreasuryUnderfunded(error?: string): boolean {
  return !!error && /not have enough funds|insufficient|LackBalanceForState/i.test(error);
}

// Module-level flag to warn once when derivationSalt is not configured
let warnedNoDerivationSalt = false;

/**
 * MPC Account Manager
 */
export class MPCAccountManager {
  private networkId: 'testnet' | 'mainnet';
  private mpcContractId: string;
  private accountPrefix: string;
  private treasuryAccount?: string;
  private keyPair?: KeyPair;  // MPC-09: KeyPair object replaces raw private key string
  private fundingAmount: string;
  private derivationSalt?: string;
  private log: Logger;

  constructor(config: MPCConfig) {
    this.networkId = config.networkId;
    this.mpcContractId = getMPCContractId(config.networkId);
    this.accountPrefix = config.accountPrefix || 'anon';
    this.treasuryAccount = config.treasuryAccount;
    if (config.treasuryPrivateKey) {
      // MPC-09: one-time materialization. The raw config.treasuryPrivateKey string
      // is consumed here and is NOT retained as an instance field. Both signing
      // call sites (fundAccountFromTreasury, addRecoveryWallet) accept this
      // KeyPair object directly so the raw private-key string never re-appears
      // on the call stack.
      this.keyPair = KeyPair.fromString(config.treasuryPrivateKey as `ed25519:${string}`);
    }
    this.fundingAmount = config.fundingAmount || '0.01';
    this.derivationSalt = config.derivationSalt;
    this.log = (config.logger ?? pino({ level: 'silent' })).child({ module: 'mpc' });
  }

  /**
   * Create a NEAR account for an anonymous user.
   *
   * Pure function of (treasuryAccount, userId, derivationSalt) — same args
   * always produce the same nearAccountId/derivationPath/mpcPublicKey (MPC-02).
   *
   * Idempotent: a second call against an already-provisioned account
   * short-circuits via view_account, issuing zero additional transfers (MPC-03).
   *
   * Concurrent-safe: nonce-race losers retry view_account once and return
   * success when the winner has already provisioned the account (MPC-06).
   *
   * Error paths throw with cause (MPC-10):
   *   - 'RPC unreachable' when fetch() itself throws (treasury-funded path only)
   *   - 'Treasury underfunded' when broadcast_tx_commit error indicates insufficient balance
   *   - 'Transfer failed' for other broadcast failures
   *
   * Backward-compat: when no treasury is configured, returns { onChain: false }
   * without throwing — used by createAnonAuth's dormant-account flow.
   */
  async createAccount(userId: string): Promise<MPCAccount> {
    // Step 1: Deterministic derivation (MPC-02, MPC-04)
    if (!this.derivationSalt && !warnedNoDerivationSalt) {
      this.log.warn('No derivationSalt configured -- account IDs are predictable from user IDs. Set derivationSalt for production use.');
      warnedNoDerivationSalt = true;
    }

    const seedInput = this.derivationSalt
      ? `implicit-${this.derivationSalt}-${userId}`
      : `implicit-${userId}`;
    const seed = createHash('sha256').update(seedInput).digest();
    const publicKeyBytes = derivePublicKey(seed);
    const implicitAccountId = publicKeyBytes.toString('hex');  // MPC-04: 64 hex chars
    const publicKey = `ed25519:${bs58.encode(publicKeyBytes)}`;
    const derivationPath = `near-anon-auth,${userId}`;

    this.log.info({ accountId: implicitAccountId, network: this.networkId }, 'Creating NEAR account');

    // Step 2: Idempotency check (MPC-03) — view_account short-circuit
    const alreadyExists = await accountExists(implicitAccountId, this.networkId);
    if (alreadyExists) {
      this.log.info({ accountId: implicitAccountId }, 'Implicit account already on-chain, short-circuiting');
      return {
        nearAccountId: implicitAccountId,
        derivationPath,
        mpcPublicKey: publicKey,
        onChain: true,
      };
    }

    // Step 3: No-treasury backward-compat path — return dormant
    // (Required for createAnonAuth dormant flow and SEC-04 derivation tests.)
    if (!this.treasuryAccount || !this.keyPair) {
      this.log.warn('No treasury configured, account will be dormant until funded');
      return {
        nearAccountId: implicitAccountId,
        derivationPath,
        mpcPublicKey: publicKey,
        onChain: false,
      };
    }

    // Step 4: Fund from treasury — failures THROW (MPC-10)
    this.log.info({ accountId: implicitAccountId }, 'Funding implicit account from treasury');
    const fundResult = await fundAccountFromTreasury(
      implicitAccountId,
      this.treasuryAccount,
      this.keyPair,             // MPC-09: pass KeyPair object directly; raw key string never re-appears on call stack
      this.fundingAmount,
      this.networkId,
      this.log
    );

    if (fundResult.success) {
      this.log.info({ txHash: fundResult.txHash }, 'Account funded');
      return {
        nearAccountId: implicitAccountId,
        derivationPath,
        mpcPublicKey: publicKey,
        onChain: true,
      };
    }

    // Step 5: Concurrent-call convergence (MPC-06)
    // If broadcast failed with a nonce-race indicator, re-check view_account.
    // The winner of the race already provisioned the account.
    if (isLikelyNonceRace(fundResult.error)) {
      const existsNow = await accountExists(implicitAccountId, this.networkId);
      if (existsNow) {
        this.log.info({ accountId: implicitAccountId }, 'Concurrent provisioning detected; account now exists');
        return {
          nearAccountId: implicitAccountId,
          derivationPath,
          mpcPublicKey: publicKey,
          onChain: true,
        };
      }
    }

    // Step 6: Classify error and throw with cause (MPC-10)
    const errorText = fundResult.error || 'Unknown funding failure';
    if (isRpcUnreachable(errorText)) {
      throw new Error('RPC unreachable', { cause: new Error(errorText) });
    }
    if (isTreasuryUnderfunded(errorText)) {
      throw new Error('Treasury underfunded', { cause: new Error(errorText) });
    }
    throw new Error('Transfer failed', { cause: new Error(errorText) });
  }

  /**
   * Add a recovery wallet as an access key to the MPC account
   *
   * This creates an on-chain link without storing it in our database.
   * The recovery wallet can be used to prove ownership and create new passkeys.
   *
   * @param nearAccountId - The user's NEAR implicit account ID
   * @param recoveryWalletPublicKey - The recovery wallet's public key in ed25519:BASE58 format
   */
  async addRecoveryWallet(
    nearAccountId: string,
    recoveryWalletPublicKey: string
  ): Promise<{ success: boolean; txHash?: string }> {
    this.log.info({ nearAccountId }, 'Adding recovery wallet via AddKey transaction');

    if (!this.keyPair) {
      this.log.error('No treasury private key configured — cannot sign AddKey transaction');
      return { success: false };
    }

    try {
      const rpcUrl = getRPCUrl(this.networkId);

      // MPC-09: use the cached KeyPair object directly. The raw private-key
      // string was consumed once in the constructor and is not re-materialized here.
      const signer = new KeyPairSigner(this.keyPair);
      const signerPublicKey = await signer.getPublicKey();
      const signerPublicKeyStr = signerPublicKey.toString();

      // Fetch access key nonce + block hash for the signer's key on the user's account
      const accessKeyResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-access-key',
          method: 'query',
          params: {
            request_type: 'view_access_key',
            finality: 'final',
            account_id: nearAccountId,
            public_key: signerPublicKeyStr,
          },
        }),
      });

      const accessKeyResult = await accessKeyResponse.json() as {
        result?: { nonce: number; block_hash: string };
        error?: { cause?: { name: string }; message?: string };
      };

      if (accessKeyResult.error || !accessKeyResult.result) {
        this.log.error(
          { err: new Error(JSON.stringify(accessKeyResult.error)) },
          'Could not fetch access key for AddKey transaction'
        );
        return { success: false };
      }

      const nonce = BigInt(accessKeyResult.result.nonce) + 1n;
      // blockHash MUST be Uint8Array (raw bytes), NOT the base58 string
      const blockHashBytes = bs58.decode(accessKeyResult.result.block_hash);

      // Build the AddKey action using @near-js/transactions actionCreators
      const { addKey, fullAccessKey } = actionCreators;
      const recoveryPublicKey = PublicKey.fromString(recoveryWalletPublicKey);
      const action = addKey(recoveryPublicKey, fullAccessKey());

      // Create the transaction — signerId and receiverId are both the user's account
      const tx = createTransaction(
        nearAccountId,     // signerId
        signerPublicKey,   // must match signer.getPublicKey()
        nearAccountId,     // receiverId (adding key to user's own account)
        nonce,
        [action],
        blockHashBytes     // Uint8Array, NOT base58 string
      );

      // Sign — internally: encodeTransaction(tx) → sha256 → sign
      const [, signedTx] = await signer.signTransaction(tx);

      // Encode for RPC broadcast
      const encoded = Buffer.from(signedTx.encode()).toString('base64');

      // Broadcast via broadcast_tx_commit
      const submitResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'send-tx',
          method: 'broadcast_tx_commit',
          params: [encoded],
        }),
      });

      const submitResult = await submitResponse.json() as {
        result?: { transaction: { hash: string } };
        error?: { data?: string; message?: string };
      };

      if (submitResult.error) {
        this.log.error(
          { err: new Error(submitResult.error.data || submitResult.error.message || 'Transaction failed') },
          'AddKey transaction broadcast failed'
        );
        return { success: false };
      }

      const txHash = submitResult.result?.transaction?.hash || 'unknown';
      this.log.info({ nearAccountId, txHash }, 'Recovery wallet added via AddKey');

      return { success: true, txHash };
    } catch (error) {
      this.log.error({ err: error }, 'addRecoveryWallet failed');
      return { success: false };
    }
  }

  /**
   * Verify that a wallet has FullAccess to an account (MPC-05).
   *
   * Returns true ONLY for FullAccess access keys (FunctionCall keys → false).
   * Returns false (does not throw) when the account is missing/deleted (MPC-04).
   * Throws when fetch() itself throws (RPC unreachable — MPC-10) so the
   * consumer route can return 500.
   *
   * @param nearAccountId - The user's NEAR implicit account ID (64-char hex)
   * @param recoveryWalletPublicKey - The recovery wallet's public key in ed25519:BASE58 format
   */
  async verifyRecoveryWallet(
    nearAccountId: string,
    recoveryWalletPublicKey: string
  ): Promise<boolean> {
    // Delegate to checkWalletAccess (post-Plan-03):
    //   - FullAccess → true; FunctionCall → false
    //   - UNKNOWN_ACCOUNT/UNKNOWN_ACCESS_KEY → false (no throw)
    //   - fetch failure → throws (let it propagate to consumer)
    return await checkWalletAccess(nearAccountId, recoveryWalletPublicKey, this.networkId);
  }

  /**
   * Get MPC contract ID
   */
  getMPCContractId(): string {
    return this.mpcContractId;
  }

  /**
   * Get network ID
   */
  getNetworkId(): string {
    return this.networkId;
  }
}

/**
 * Create MPC account manager
 */
export function createMPCManager(config: MPCConfig): MPCAccountManager {
  return new MPCAccountManager(config);
}
