import { createHash } from "node:crypto";

import type {
  SharedRateLimitBucket,
  SharedRateLimitIncrement,
  SharedRateLimitStore,
} from "@safeexit/security";

import type { PrismaClient } from "./generated/prisma/client";

export async function checkSharedRateLimitStore(client: PrismaClient): Promise<void> {
  await client.$queryRaw`SELECT "key" FROM "rate_limit_buckets" LIMIT 1`;
}

export async function pruneExpiredRateLimitBuckets(
  client: PrismaClient,
  now = new Date(),
): Promise<number> {
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const result = await client.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: retentionCutoff } },
  });
  return result.count;
}

export class PrismaRateLimitStore implements SharedRateLimitStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly namespace = "safeexit",
  ) {}

  async increment(input: SharedRateLimitIncrement): Promise<SharedRateLimitBucket> {
    const key = createHash("sha256")
      .update(`${this.namespace}:${input.key}`)
      .digest("hex");
    const rows = await this.client.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at", "updated_at")
      VALUES (${key}, 1, ${input.resetAt}, ${input.now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "rate_limit_buckets"."reset_at" <= EXCLUDED."updated_at" THEN 1
          ELSE "rate_limit_buckets"."count" + 1
        END,
        "reset_at" = CASE
          WHEN "rate_limit_buckets"."reset_at" <= EXCLUDED."updated_at"
            THEN EXCLUDED."reset_at"
          ELSE "rate_limit_buckets"."reset_at"
        END,
        "updated_at" = EXCLUDED."updated_at"
      RETURNING "count", "reset_at" AS "resetAt"
    `;
    const bucket = rows[0];
    if (!bucket) {
      throw new Error("Shared rate-limit update returned no bucket");
    }
    return bucket;
  }
}
