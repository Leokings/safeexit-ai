import { NextRequest, NextResponse } from "next/server";

import {
  createSafeExitServiceManifest,
  safeExitPublicDiscoveryHeaders,
} from "@/lib/safeexit-service-discovery";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    createSafeExitServiceManifest(request.url),
    {
      status: 200,
      headers: safeExitPublicDiscoveryHeaders("application/json"),
    },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: safeExitPublicDiscoveryHeaders("application/json"),
  });
}
