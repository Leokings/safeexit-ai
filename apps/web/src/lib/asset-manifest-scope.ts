type Erc20Candidate = {
  tokenAddress: string;
};

export function selectManifestScopedErc20Candidates<T extends Erc20Candidate>(
  candidates: readonly T[],
  explicitTokenAddresses?: readonly string[],
  maximum = 50,
): T[] {
  const explicitScope = explicitTokenAddresses
    ? new Set(explicitTokenAddresses.map((address) => address.toLowerCase()))
    : undefined;
  const unique = new Map<string, T>();

  for (const candidate of candidates) {
    const address = candidate.tokenAddress.toLowerCase();
    if (explicitScope && !explicitScope.has(address)) {
      continue;
    }
    if (!unique.has(address)) {
      unique.set(address, candidate);
    }
  }

  return [...unique.values()].slice(0, maximum);
}
