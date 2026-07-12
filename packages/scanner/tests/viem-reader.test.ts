import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { anvilLocal } from "@safeexit/chain";
import { evmAddressSchema } from "@safeexit/shared";

import { ViemStandardReadClient } from "../src";

const ownerAddress = evmAddressSchema.parse(
  "0x1111111111111111111111111111111111111111",
);
const contractAddress = evmAddressSchema.parse(
  "0x2222222222222222222222222222222222222222",
);
const operatorAddress = evmAddressSchema.parse(
  "0x3333333333333333333333333333333333333333",
);

describe("ViemStandardReadClient", () => {
  it("maps each scanner read to a block-pinned standard contract call", async () => {
    const readContract = vi.fn(
      async (request: { functionName: string; args: readonly unknown[] }) => {
        switch (request.functionName) {
          case "ownerOf":
            return ownerAddress;
          case "isApprovedForAll":
            return true;
          case "allowance":
            return 25n;
          case "balanceOf":
            return request.args.length === 2 ? 3n : 10n;
          default:
            throw new Error(`Unexpected function: ${request.functionName}`);
        }
      },
    );
    const publicClient = {
      chain: anvilLocal,
      getBlockNumber: vi.fn(async () => 100n),
      getBalance: vi.fn(async () => 5n),
      readContract,
    } as unknown as PublicClient;
    const reader = new ViemStandardReadClient("mock-viem", publicClient);

    expect(await reader.getBlockNumber()).toBe(100n);
    expect(await reader.getNativeBalance(ownerAddress, 99n)).toBe(5n);
    expect(await reader.getErc20Balance(contractAddress, ownerAddress, 99n)).toBe(10n);
    expect(await reader.getErc721Owner(contractAddress, 7n, 99n)).toBe(ownerAddress);
    expect(await reader.getErc1155Balance(contractAddress, ownerAddress, 7n, 99n)).toBe(
      3n,
    );
    expect(
      await reader.getErc20Allowance(
        contractAddress,
        ownerAddress,
        operatorAddress,
        99n,
      ),
    ).toBe(25n);
    expect(
      await reader.getNftOperatorApproval(
        contractAddress,
        ownerAddress,
        operatorAddress,
        99n,
      ),
    ).toBe(true);

    expect(publicClient.getBalance).toHaveBeenCalledWith({
      address: ownerAddress,
      blockNumber: 99n,
    });
    expect(readContract).toHaveBeenCalledTimes(5);
    for (const [request] of readContract.mock.calls) {
      expect(request).toMatchObject({ blockNumber: 99n });
    }
  });

  it("requires a configured chain", () => {
    const publicClient = {
      chain: undefined,
    } as unknown as PublicClient;

    expect(() => new ViemStandardReadClient("unconfigured", publicClient)).toThrow(
      "A configured viem chain is required",
    );
  });
});

