import type { SigningPackage } from "@safeexit/agent-service";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export type ReceiptSubmissionTransaction = {
  from: string;
  to: string | null;
  value: bigint;
};

export function assertReceiptSubmissionTransaction(
  signingPackage: SigningPackage,
  transaction: ReceiptSubmissionTransaction,
): void {
  if (!sameAddress(transaction.from, signingPackage.destinationAddress)) {
    throw new Error("Receipt transaction was not submitted by the committed destination");
  }
  if (!transaction.to) {
    throw new Error("Receipt transaction cannot be a contract deployment");
  }
  const expectedTarget = signingPackage.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION"
    ? signingPackage.tokenAddress
    : signingPackage.settlementContract;
  if (!sameAddress(transaction.to, expectedTarget)) {
    throw new Error("Receipt transaction target does not match the issued recovery route");
  }
  if (transaction.value !== 0n) {
    throw new Error("Destination-paid settlement must not transfer native value");
  }
}
