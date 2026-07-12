import { runAgentJobAction } from "@/lib/agent-route-action";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return runAgentJobAction("analyse", request, (await context.params).id);
}
