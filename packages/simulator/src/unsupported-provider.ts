import type { RescueAction, SimulationResult } from "@safeexit/shared";

import { createSimulationResult } from "./result";
import type {
  SimulationProvider,
  SimulationRequest,
  SimulationSupport,
} from "./types";

export type OfficialDocsRequiredSimulationProviderOptions = {
  id: string;
  displayName: string;
  officialDocumentationUrl?: string;
  clock?: () => Date;
};

export class OfficialDocsRequiredSimulationProvider implements SimulationProvider {
  readonly id: string;
  readonly kind = "PRODUCTION_ADAPTER" as const;
  readonly officialDocsRequired = true;
  private readonly clock: () => Date;

  constructor(private readonly options: OfficialDocsRequiredSimulationProviderOptions) {
    this.id = options.id;
    this.clock = options.clock ?? (() => new Date());
  }

  async supports(
    chainId: number,
    action: RescueAction,
  ): Promise<SimulationSupport> {
    void chainId;
    void action;
    return {
      supported: false,
      reason: `${this.options.displayName} requires verified official documentation and an implemented adapter`,
    };
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const support = await this.supports(request.action.chainId, request.action);
    return createSimulationResult({
      providerId: this.id,
      request,
      status: "UNSUPPORTED",
      failureReason:
        support.reason ?? "Production simulation adapter requires official documentation",
      warnings: this.options.officialDocumentationUrl
        ? [`Official documentation: ${this.options.officialDocumentationUrl}`]
        : [],
      clock: this.clock,
      ttlMs: 60_000,
    });
  }
}
