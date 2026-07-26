import { PrivateKeySignerEvm } from "@tetherto/wdk-wallet-evm/signers";
import type { Eip7702SourceAuthorizationSignerPort } from "@safeexit/buyer-runtime/eip7702-runtime";
import {
  getAddress,
  zeroAddress,
  type AuthorizationRequest,
  type Hex,
  type SignedAuthorization,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

export const SAFEEXIT_WDK_SIGNER_BACKEND =
  "@tetherto/wdk-wallet-evm@1.0.0-beta.16" as const;

export type WdkSignerState =
  | "READY"
  | "DELEGATION_SIGNED"
  | "DISPOSED";

export type WdkSignerPolicy = Readonly<{
  chainId: 196;
  sourceAddress: `0x${string}`;
  delegateAddress: `0x${string}`;
  sourceNonce: number;
}>;

export type WdkSignerErrorCode =
  | "INVALID_POLICY"
  | "SOURCE_MISMATCH"
  | "SIGNER_DISPOSED"
  | "AUTHORIZATION_OUT_OF_SCOPE"
  | "INVALID_AUTHORIZATION";

export class WdkSignerError extends Error {
  constructor(
    readonly code: WdkSignerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WdkSignerError";
  }
}

type WdkAuthorization = Awaited<
  ReturnType<PrivateKeySignerEvm["signAuthorization"]>
>;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requestAddress(request: AuthorizationRequest): `0x${string}` {
  const address = "address" in request
    ? request.address
    : request.contractAddress;
  if (!address) {
    throw new WdkSignerError(
      "AUTHORIZATION_OUT_OF_SCOPE",
      "The authorization request has no delegate address.",
    );
  }
  return getAddress(address);
}

function normalizePolicy(policy: WdkSignerPolicy): WdkSignerPolicy {
  if (
    policy.chainId !== 196 ||
    !Number.isSafeInteger(policy.sourceNonce) ||
    policy.sourceNonce < 0 ||
    policy.sourceNonce >= Number.MAX_SAFE_INTEGER ||
    sameAddress(policy.delegateAddress, zeroAddress)
  ) {
    throw new WdkSignerError(
      "INVALID_POLICY",
      "The WDK signer requires a bounded X Layer delegation policy.",
    );
  }

  return Object.freeze({
    chainId: 196,
    sourceAddress: getAddress(policy.sourceAddress),
    delegateAddress: getAddress(policy.delegateAddress),
    sourceNonce: policy.sourceNonce,
  });
}

function toSignedAuthorization(
  authorization: WdkAuthorization,
): SignedAuthorization {
  const chainId = Number(authorization.chainId);
  const nonce = Number(authorization.nonce);
  const r = authorization.signature.r as Hex;
  const s = authorization.signature.s as Hex;
  const yParity = authorization.signature.yParity;

  if (
    !Number.isSafeInteger(chainId) ||
    !Number.isSafeInteger(nonce) ||
    (yParity !== 0 && yParity !== 1) ||
    !/^0x[a-fA-F0-9]{64}$/.test(r) ||
    !/^0x[a-fA-F0-9]{64}$/.test(s)
  ) {
    throw new WdkSignerError(
      "INVALID_AUTHORIZATION",
      "WDK returned an invalid EIP-7702 authorization.",
    );
  }

  return {
    address: getAddress(authorization.address),
    chainId,
    nonce,
    yParity,
    r,
    s,
  };
}

export class WdkEip7702SourceSigner
  implements Eip7702SourceAuthorizationSignerPort
{
  readonly #policy: WdkSignerPolicy;
  #signer: PrivateKeySignerEvm | undefined;
  #state: WdkSignerState = "READY";

  private constructor(
    signer: PrivateKeySignerEvm,
    policy: WdkSignerPolicy,
  ) {
    this.#signer = signer;
    this.#policy = policy;
  }

  static async takeOwnership(input: {
    privateKeyBytes: Uint8Array;
    policy: WdkSignerPolicy;
  }): Promise<WdkEip7702SourceSigner> {
    const policy = normalizePolicy(input.policy);
    if (
      !(input.privateKeyBytes instanceof Uint8Array) ||
      input.privateKeyBytes.length !== 32
    ) {
      if (input.privateKeyBytes instanceof Uint8Array) {
        input.privateKeyBytes.fill(0);
      }
      throw new WdkSignerError(
        "INVALID_POLICY",
        "The local WDK signer requires exactly 32 private-key bytes.",
      );
    }

    let signer: PrivateKeySignerEvm | undefined;
    try {
      signer = new PrivateKeySignerEvm(input.privateKeyBytes);
      const signerAddress = getAddress(await signer.getAddress());
      if (!sameAddress(signerAddress, policy.sourceAddress)) {
        throw new WdkSignerError(
          "SOURCE_MISMATCH",
          "The local WDK signer does not control the committed source address.",
        );
      }
      return new WdkEip7702SourceSigner(signer, policy);
    } catch (error) {
      signer?.dispose();
      input.privateKeyBytes.fill(0);
      if (error instanceof WdkSignerError) throw error;
      throw new WdkSignerError(
        "INVALID_POLICY",
        "The local WDK signer could not initialize.",
      );
    }
  }

  get state(): WdkSignerState {
    return this.#state;
  }

  async getAddress(): Promise<`0x${string}`> {
    this.#assertActive();
    return this.#policy.sourceAddress;
  }

  async signAuthorization(
    request: AuthorizationRequest,
  ): Promise<SignedAuthorization> {
    const signer = this.#assertActive();
    const address = requestAddress(request);
    const expected =
      this.#state === "READY"
        ? {
            address: this.#policy.delegateAddress,
            nonce: this.#policy.sourceNonce,
          }
        : {
            address: zeroAddress,
            nonce: this.#policy.sourceNonce + 1,
          };

    if (
      request.chainId !== this.#policy.chainId ||
      request.nonce !== expected.nonce ||
      !sameAddress(address, expected.address)
    ) {
      throw new WdkSignerError(
        "AUTHORIZATION_OUT_OF_SCOPE",
        "The authorization is outside the committed delegation-and-clearing sequence.",
      );
    }

    try {
      const signed = toSignedAuthorization(
        await signer.signAuthorization({
          chainId: request.chainId,
          address,
          nonce: request.nonce,
        }),
      );
      if (
        signed.chainId !== request.chainId ||
        signed.nonce !== request.nonce ||
        !sameAddress(signed.address, address)
      ) {
        throw new WdkSignerError(
          "INVALID_AUTHORIZATION",
          "WDK signed an authorization outside the committed scope.",
        );
      }
      const recovered = getAddress(
        await recoverAuthorizationAddress({ authorization: signed }),
      );
      if (!sameAddress(recovered, this.#policy.sourceAddress)) {
        throw new WdkSignerError(
          "INVALID_AUTHORIZATION",
          "The WDK authorization does not recover to the committed source.",
        );
      }

      if (this.#state === "READY") {
        this.#state = "DELEGATION_SIGNED";
      } else {
        this.dispose();
      }
      return Object.freeze(signed);
    } catch (error) {
      this.dispose();
      if (error instanceof WdkSignerError) throw error;
      throw new WdkSignerError(
        "INVALID_AUTHORIZATION",
        "WDK could not sign the bounded EIP-7702 authorization.",
      );
    }
  }

  dispose(): void {
    this.#signer?.dispose();
    this.#signer = undefined;
    this.#state = "DISPOSED";
  }

  #assertActive(): PrivateKeySignerEvm {
    if (!this.#signer || this.#state === "DISPOSED") {
      throw new WdkSignerError(
        "SIGNER_DISPOSED",
        "The ephemeral WDK signer is no longer available.",
      );
    }
    return this.#signer;
  }
}
