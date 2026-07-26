import { eip7702LocalSigningPackageSchema } from "@safeexit/agent-service/eip7702-signing-package";
import { XLAYER_SAFEEXIT_EIP7702_FACTORY_V2 } from "@safeexit/buyer-runtime/eip7702-trust";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import {
  SAFEEXIT_XLAYER_VERIFICATION_RPCS,
  assertTrustedEip7702FactoryObservations,
} from "../src/factory-verifier";
import { signingPackageFixture } from "./fixtures";

function observations(delegateAddress: string) {
  return SAFEEXIT_XLAYER_VERIFICATION_RPCS.map((rpcUrl) => ({
    rpcUrl,
    chainId: 196,
    factoryRuntimeHash: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2.runtimeHash,
    predictedDelegateAddress: getAddress(delegateAddress),
  }));
}

describe("extension factory verifier", () => {
  it("requires two matching verified-factory predictions", () => {
    const signingPackage = eip7702LocalSigningPackageSchema.parse(
      signingPackageFixture(),
    );
    expect(
      assertTrustedEip7702FactoryObservations(
        signingPackage,
        observations(signingPackage.delegateAddress),
      ),
    ).toEqual(signingPackage);
  });

  it("rejects an arbitrary delegate even when package factory metadata is pinned", () => {
    const signingPackage = eip7702LocalSigningPackageSchema.parse(
      signingPackageFixture(),
    );
    expect(() =>
      assertTrustedEip7702FactoryObservations(
        signingPackage,
        observations("0x9999999999999999999999999999999999999999"),
      ),
    ).toThrow("not predicted");
  });

  it("rejects missing quorum or a mismatched factory runtime", () => {
    const signingPackage = eip7702LocalSigningPackageSchema.parse(
      signingPackageFixture(),
    );
    expect(() =>
      assertTrustedEip7702FactoryObservations(
        signingPackage,
        observations(signingPackage.delegateAddress).slice(0, 1),
      ),
    ).toThrow("Two independent");

    const mismatched = observations(signingPackage.delegateAddress);
    expect(() =>
      assertTrustedEip7702FactoryObservations(signingPackage, [
        mismatched[0]!,
        {
          ...mismatched[1]!,
          factoryRuntimeHash: `0x${"ff".repeat(32)}`,
        },
      ]),
    ).toThrow("not predicted");
  });

  it("rejects observations from unpinned RPCs", () => {
    const signingPackage = eip7702LocalSigningPackageSchema.parse(
      signingPackageFixture(),
    );
    const mismatched = observations(signingPackage.delegateAddress);
    expect(() =>
      assertTrustedEip7702FactoryObservations(signingPackage, [
        mismatched[0]!,
        {
          ...mismatched[1]!,
          rpcUrl: "https://example.invalid",
        },
      ]),
    ).toThrow("pinned X Layer RPCs");
  });
});
