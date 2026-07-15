import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getPrismaClient,
  PrismaAgentServiceJobStore,
} from "@safeexit/persistence";

import { getAgentIncidentService } from "@/lib/agent-runtime";
import { parseDeploymentEnvironment } from "@/lib/deployment-env";

export const runtime = "nodejs";
export const maxDuration = 60;

function hasValidCronAuthorization(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(authorization);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function GET(request: Request): Promise<Response> {
  const config = parseDeploymentEnvironment();
  if (!config.cronSecret) {
    return NextResponse.json(
      { code: "CRON_NOT_CONFIGURED", message: "Receipt reconciliation is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!hasValidCronAuthorization(request, config.cronSecret)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Valid cron authorization is required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const store = new PrismaAgentServiceJobStore(getPrismaClient());
  const jobs = await store.listByStatuses(
    ["WAITING_FOR_USER", "SIGNING", "EXECUTING"],
    25,
  );
  let checked = 0;
  let confirmed = 0;
  let terminalFailures = 0;
  let pending = 0;
  let errors = 0;

  for (const job of jobs) {
    if (!job.incident) continue;
    const submissions = (job.receiptSubmissions ?? [])
      .filter((submission) => submission.status === "PENDING");
    if (submissions.length === 0) continue;
    const service = getAgentIncidentService({ chainId: job.incident.chainId });
    for (const submission of submissions) {
      checked += 1;
      try {
        const result = await service.reconcileBuyerReceiptSubmission(job.id, {
          packageId: submission.packageId,
          transactionHash: submission.transactionHash,
        });
        if (result.status === "CONFIRMED") confirmed += 1;
        else if (result.status === "PENDING") pending += 1;
        else terminalFailures += 1;
      } catch {
        errors += 1;
      }
    }
  }

  return NextResponse.json(
    { checked, confirmed, terminalFailures, pending, errors },
    { headers: { "Cache-Control": "no-store" } },
  );
}
