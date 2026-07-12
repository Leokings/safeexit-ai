export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      service: "safeexit-web",
      version: "0.1.0",
      deploymentId:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.SAFEEXIT_DEPLOYMENT_ID ??
        "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
