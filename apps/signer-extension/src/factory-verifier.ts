import { eip7702RescueDelegateFactoryAbi } from "@safeexit/adapters/eip7702-rescue";
import {
  eip7702LocalSigningPackageSchema,
  type Eip7702LocalSigningPackage,
} from "@safeexit/agent-service/eip7702-signing-package";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime/eip7702-trust";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Hex,
} from "viem";
import { xLayer } from "viem/chains";

export const SAFEEXIT_XLAYER_VERIFICATION_RPCS = Object.freeze([
  "https://rpc.xlayer.tech",
  "https://xlayerrpc.okx.com",
] as const);

export type Eip7702FactoryObservation = Readonly<{
  rpcUrl: string;
  chainId: number;
  factoryRuntimeHash: Hex;
  predictedDelegateAddress: `0x${string}`;
}>;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function assertTrustedEip7702FactoryObservations(
  packageValue: unknown,
  observations: readonly Eip7702FactoryObservation[],
): Eip7702LocalSigningPackage {
  const signingPackage = eip7702LocalSigningPackageSchema.parse(packageValue);
  if (
    signingPackage.chainId !== XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.chainId ||
    !sameAddress(
      signingPackage.factoryAddress,
      XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
    ) ||
    signingPackage.factoryRuntimeHash.toLowerCase() !==
      XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash.toLowerCase()
  ) {
    throw new Error("The signing package does not use the pinned V2 factory");
  }
  if (
    observations.length !== SAFEEXIT_XLAYER_VERIFICATION_RPCS.length ||
    new Set(observations.map((observation) => observation.rpcUrl)).size !==
      observations.length
  ) {
    throw new Error("Two independent X Layer factory observations are required");
  }
  const expectedRpcUrls = new Set<string>(SAFEEXIT_XLAYER_VERIFICATION_RPCS);
  if (
    observations.some((observation) => !expectedRpcUrls.has(observation.rpcUrl))
  ) {
    throw new Error("Factory observations must use the pinned X Layer RPCs");
  }

  for (const observation of observations) {
    if (
      observation.chainId !== signingPackage.chainId ||
      observation.factoryRuntimeHash.toLowerCase() !==
        XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash.toLowerCase() ||
      !sameAddress(
        observation.predictedDelegateAddress,
        signingPackage.delegateAddress,
      )
    ) {
      throw new Error(
        "The delegate address is not predicted by the verified V2 factory",
      );
    }
  }
  return signingPackage;
}

export async function verifyEip7702FactoryPackage(
  packageValue: unknown,
): Promise<Eip7702LocalSigningPackage> {
  const signingPackage = eip7702LocalSigningPackageSchema.parse(packageValue);
  const observations = await Promise.all(
    SAFEEXIT_XLAYER_VERIFICATION_RPCS.map(async (rpcUrl) => {
      const client = createPublicClient({
        chain: xLayer,
        transport: http(rpcUrl, {
          retryCount: 1,
          timeout: 8_000,
        }),
      });
      const [chainId, factoryCode, predictedDelegateAddress] = await Promise.all([
        client.getChainId(),
        client.getCode({
          address: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
        }),
        client.readContract({
          address: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.address,
          abi: eip7702RescueDelegateFactoryAbi,
          functionName: "predictDelegate",
          args: [
            getAddress(signingPackage.sourceAddress),
            getAddress(signingPackage.destinationAddress),
            BigInt(signingPackage.deadline),
            signingPackage.delegatePlanHash as Hex,
            signingPackage.rescueNonce as Hex,
          ],
        }),
      ]);
      if (!factoryCode || factoryCode === "0x") {
        throw new Error("The pinned V2 factory is not deployed");
      }
      return {
        rpcUrl,
        chainId,
        factoryRuntimeHash: keccak256(factoryCode),
        predictedDelegateAddress: getAddress(predictedDelegateAddress),
      } satisfies Eip7702FactoryObservation;
    }),
  );
  return assertTrustedEip7702FactoryObservations(
    signingPackage,
    observations,
  );
}
