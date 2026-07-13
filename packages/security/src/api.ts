import { z, type ZodType } from "zod";

import {
  chainIdSchema,
  evmAddressSchema,
  rescueAssetManifestSchema,
} from "@safeexit/shared";

export const createIncidentRequestSchema = z
  .strictObject({
    chainId: chainIdSchema,
    sourceAddress: evmAddressSchema,
    destinationAddress: evmAddressSchema,
    assetManifest: rescueAssetManifestSchema,
    authorizationConfirmed: z.literal(true),
  })
  .superRefine(({ sourceAddress, destinationAddress }, context) => {
    if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
      context.addIssue({
        code: "custom",
        message: "Source and destination addresses must be different",
        path: ["destinationAddress"],
      });
    }
  });

export const apiSecurityEnvironmentSchema = z.strictObject({
  maxRequests: z.coerce.number().int().min(1).max(1_000).default(20),
  windowMs: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
});

export type CreateIncidentRequest = z.infer<typeof createIncidentRequestSchema>;

export class ApiInputError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 422,
    readonly code:
      | "INVALID_CONTENT_TYPE"
      | "BODY_TOO_LARGE"
      | "INVALID_JSON"
      | "VALIDATION_FAILED",
    message: string,
    readonly issues?: readonly { path: PropertyKey[]; message: string }[],
  ) {
    super(message);
    this.name = "ApiInputError";
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const maxBytes = options.maxBytes ?? 16_384;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ApiInputError(
      415,
      "INVALID_CONTENT_TYPE",
      "Content-Type must be application/json",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiInputError(413, "BODY_TOO_LARGE", "Request body is too large");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new ApiInputError(413, "BODY_TOO_LARGE", "Request body is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ApiInputError(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiInputError(
      422,
      "VALIDATION_FAILED",
      "Request validation failed",
      result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseApiSecurityEnvironment(environment: NodeJS.ProcessEnv) {
  return apiSecurityEnvironmentSchema.parse({
    maxRequests: environment.SAFEEXIT_RATE_LIMIT_MAX_REQUESTS,
    windowMs: environment.SAFEEXIT_RATE_LIMIT_WINDOW_MS,
  });
}
