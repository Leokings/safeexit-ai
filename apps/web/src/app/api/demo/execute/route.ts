import { spawn } from "node:child_process";
import path from "node:path";

import { ApiInputError, createSecureLogger, parseJsonBody } from "@safeexit/security";

import { executeDemoRequestSchema } from "@/lib/demo-runtime";
import { getWorkspaceRoot, readDemoRuntimeState } from "@/lib/demo-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createSecureLogger();
let executionInFlight = false;

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (
      process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      return response(
        {
          code: "LOCAL_DEMO_ONLY",
          message: "Fixed demo execution is available only on a local development server.",
        },
        403,
      );
    }
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== url.origin) {
      return response({ code: "ORIGIN_REJECTED", message: "Request origin was rejected." }, 403);
    }

    await parseJsonBody(request, executeDemoRequestSchema, { maxBytes: 1_024 });
    if (executionInFlight) {
      return response(
        { code: "DEMO_EXECUTION_ACTIVE", message: "The fixed demo is already executing." },
        409,
      );
    }

    const state = await readDemoRuntimeState();
    if (
      state.availability !== "READY" ||
      state.executionMode !== "LOCAL_FIXED_SCRIPT" ||
      state.actualState !== "AT_RISK" ||
      state.report?.simulation.status !== "PASSED" ||
      !state.report.simulation.snapshotReverted
    ) {
      return response(
        {
          code: "DEMO_NOT_READY",
          message: "The fixture must be freshly seeded and successfully simulated before execution.",
        },
        409,
      );
    }

    const root = getWorkspaceRoot();
    const script = path.join(root, "scripts", "demo", "run-rescue.ps1");
    executionInFlight = true;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { cwd: root, windowsHide: true, stdio: "ignore" },
    );
    child.once("error", (error) => {
      executionInFlight = false;
      logger.error("Fixed local demo process failed to start", { error });
    });
    child.once("exit", (code) => {
      executionInFlight = false;
      if (code !== 0) {
        logger.error("Fixed local demo process exited unsuccessfully", { exitCode: code });
      }
    });

    return response(
      {
        accepted: true,
        incidentId: "demo-31337",
        message: "Fixed local Anvil execution started.",
      },
      202,
    );
  } catch (error) {
    if (error instanceof ApiInputError) {
      return response({ code: error.code, message: error.message, issues: error.issues }, error.status);
    }
    logger.error("Fixed local demo request failed", { error });
    return response(
      { code: "DEMO_EXECUTION_FAILED", message: "The fixed local demo could not be started." },
      500,
    );
  }
}
