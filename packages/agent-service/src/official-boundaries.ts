import { z } from "zod";

export const okxIntegrationCapabilitySchema = z.enum([
  "ASP_REGISTRATION",
  "ESCROW",
  "AGENTIC_WALLET",
  "MARKETPLACE",
  "SERVICE_DISCOVERY",
]);

export const okxIntegrationBoundarySchema = z.strictObject({
  capability: okxIntegrationCapabilitySchema,
  status: z.literal("OFFICIAL_DOCS_REQUIRED"),
  implemented: z.literal(false),
  reason: z.string().min(1).max(500),
  officialDocsUrls: z.array(z.string().url()).min(1),
});

export const OKX_AI_INTEGRATION_BOUNDARIES = [
  {
    capability: "ASP_REGISTRATION",
    status: "OFFICIAL_DOCS_REQUIRED",
    implemented: false,
    reason:
      "Registration is performed through current Onchain OS skills and review flows; no SDK method or endpoint is assumed by SAFEEXIT.",
    officialDocsUrls: [
      "https://web3.okx.com/onchainos/dev-docs/okxai/registerasp",
      "https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction",
    ],
  },
  {
    capability: "ESCROW",
    status: "OFFICIAL_DOCS_REQUIRED",
    implemented: false,
    reason:
      "Official OKX pages currently describe escrow availability differently across ASP and payment documentation, so no escrow contract, state machine, or settlement behavior is implemented.",
    officialDocsUrls: [
      "https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction",
      "https://web3.okx.com/onchainos/dev-docs/payments/agent-seller",
    ],
  },
  {
    capability: "AGENTIC_WALLET",
    status: "OFFICIAL_DOCS_REQUIRED",
    implemented: false,
    reason:
      "SAFEEXIT does not assume Agentic Wallet authentication, key management, signing, or transaction methods.",
    officialDocsUrls: [
      "https://web3.okx.com/onchainos/dev-docs/wallet/agentic-wallet",
    ],
  },
  {
    capability: "MARKETPLACE",
    status: "OFFICIAL_DOCS_REQUIRED",
    implemented: false,
    reason:
      "Marketplace listing, review, pricing, reputation, and delivery acceptance remain external platform responsibilities.",
    officialDocsUrls: [
      "https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction",
      "https://web3.okx.com/onchainos/dev-docs/okxai/registerasp",
    ],
  },
  {
    capability: "SERVICE_DISCOVERY",
    status: "OFFICIAL_DOCS_REQUIRED",
    implemented: false,
    reason:
      "No task-hall, matching, discovery, messaging, callback, or transport API is assumed.",
    officialDocsUrls: [
      "https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction",
      "https://web3.okx.com/onchainos/dev-docs/okxai/how-to-become-a2a",
    ],
  },
] as const satisfies readonly z.input<typeof okxIntegrationBoundarySchema>[];

export type OkxIntegrationCapability = z.infer<typeof okxIntegrationCapabilitySchema>;
export type OkxIntegrationBoundary = z.infer<typeof okxIntegrationBoundarySchema>;
