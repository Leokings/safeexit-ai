import { readDemoRuntimeState } from "@/lib/demo-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await readDemoRuntimeState(), {
    headers: { "Cache-Control": "no-store" },
  });
}
