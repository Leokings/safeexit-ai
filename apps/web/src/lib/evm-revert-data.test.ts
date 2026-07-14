import { describe, expect, it } from "vitest";

import {
  findEvmRevertData,
  hasNonEmptyEvmRevertData,
} from "./evm-revert-data";

describe("EVM revert data extraction", () => {
  it("finds non-empty data through nested RPC error causes", () => {
    const error = {
      cause: {
        cause: {
          data: "0x12345678",
        },
      },
    };

    expect(findEvmRevertData(error)).toBe("0x12345678");
    expect(hasNonEmptyEvmRevertData(error)).toBe(true);
  });

  it("rejects an empty fallback revert", () => {
    expect(hasNonEmptyEvmRevertData({ cause: { data: "0x" } })).toBe(false);
  });

  it("ignores malformed and cyclic error values", () => {
    const error: { cause?: unknown; data: string } = { data: "not-hex" };
    error.cause = error;

    expect(findEvmRevertData(error)).toBeUndefined();
    expect(hasNonEmptyEvmRevertData(error)).toBe(false);
  });
});
