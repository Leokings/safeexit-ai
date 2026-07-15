export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      service: "safeexit-web",
      version: "0.1.0",
      deploymentId:
        process.env.VERCEL_DEPLOYMENT_ID ??
        process.env.VERCEL_URL ??
        process.env.SAFEEXIT_DEPLOYMENT_ID ??
        "local",
      sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
