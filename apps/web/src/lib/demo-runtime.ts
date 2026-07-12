import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const amountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const timestampSchema = z.string().datetime({ offset: true });

export const demoActionIdSchema = z.enum([
  "action:claim",
  "action:token",
  "action:nft",
  "action:revoke",
]);

export const demoReportSchema = z.strictObject({
  schemaVersion: z.literal("safeexit-demo-v1"),
  incidentId: z.literal("demo-31337"),
  phase: z.enum(["READY", "EXECUTING", "COMPLETED", "FAILED"]),
  updatedAt: timestampSchema,
  executionStartedAt: timestampSchema.nullable(),
  executionCompletedAt: timestampSchema.nullable(),
  error: z.string().max(1_000).nullable(),
  simulation: z.strictObject({
    status: z.enum(["NOT_RUN", "RUNNING", "PASSED", "FAILED"]),
    verifiedAt: timestampSchema.nullable(),
    snapshotReverted: z.boolean(),
    actions: z.array(
      z.strictObject({
        id: demoActionIdSchema,
        status: z.literal("PASSED"),
        gasUsed: amountSchema,
        transactionHash: hashSchema,
      }),
    ),
  }),
  actions: z.array(
    z.strictObject({
      id: demoActionIdSchema,
      title: z.string().min(1).max(120),
      status: z.enum(["READY", "EXECUTING", "COMPLETED", "FAILED"]),
      transactionHash: hashSchema.nullable(),
      gasUsed: amountSchema.nullable(),
    }),
  ).length(4),
  events: z.array(
    z.strictObject({
      sequence: z.number().int().nonnegative(),
      label: z.string().min(1).max(200),
      status: z.enum(["EXECUTING", "COMPLETED", "FAILED"]),
      at: timestampSchema,
    }),
  ),
});

export const demoChainSnapshotSchema = z.strictObject({
  chainId: z.literal(31_337),
  blockNumber: amountSchema,
  sourceNativeBalance: amountSchema,
  sourceTokenBalance: amountSchema,
  destinationTokenBalance: amountSchema,
  claimableReward: amountSchema,
  activeAllowance: amountSchema,
  nftOwner: addressSchema,
});

export const demoRuntimeStateSchema = z.strictObject({
  availability: z.enum(["READY", "NOT_SEEDED", "CHAIN_OFFLINE", "INVALID_FIXTURE"]),
  executionMode: z.enum(["LOCAL_FIXED_SCRIPT", "READ_ONLY_REPLAY", "DISABLED"]),
  message: z.string().min(1).max(500),
  actualState: z.enum(["AT_RISK", "EXECUTING", "RESCUED", "PARTIAL"]).optional(),
  report: demoReportSchema.optional(),
  chain: demoChainSnapshotSchema.optional(),
});

export const executeDemoRequestSchema = z.strictObject({
  incidentId: z.literal("demo-31337"),
  authorizationConfirmed: z.literal(true),
});

export type DemoReport = z.infer<typeof demoReportSchema>;
export type DemoChainSnapshot = z.infer<typeof demoChainSnapshotSchema>;
export type DemoRuntimeState = z.infer<typeof demoRuntimeStateSchema>;

const INITIAL_TOKEN_BALANCE = 100_000_000_000_000_000_000n;
const REWARD = 50_000_000_000_000_000_000n;
const ALLOWANCE = 25_000_000_000_000_000_000n;
const FINAL_TOKEN_BALANCE = 150_000_000_000_000_000_000n;

export function deriveDemoActualState(
  chain: DemoChainSnapshot,
  report: DemoReport,
  sourceAddress: string,
  destinationAddress: string,
): NonNullable<DemoRuntimeState["actualState"]> {
  const sourceBalance = BigInt(chain.sourceTokenBalance);
  const destinationBalance = BigInt(chain.destinationTokenBalance);
  const claimable = BigInt(chain.claimableReward);
  const allowance = BigInt(chain.activeAllowance);
  const nftOwner = chain.nftOwner.toLowerCase();

  if (
    sourceBalance === INITIAL_TOKEN_BALANCE &&
    destinationBalance === 0n &&
    claimable === REWARD &&
    allowance === ALLOWANCE &&
    nftOwner === sourceAddress.toLowerCase()
  ) {
    return "AT_RISK";
  }
  if (
    sourceBalance === 0n &&
    destinationBalance === FINAL_TOKEN_BALANCE &&
    claimable === 0n &&
    allowance === 0n &&
    nftOwner === destinationAddress.toLowerCase()
  ) {
    return "RESCUED";
  }
  if (report.phase === "EXECUTING") {
    return "EXECUTING";
  }
  return "PARTIAL";
}
