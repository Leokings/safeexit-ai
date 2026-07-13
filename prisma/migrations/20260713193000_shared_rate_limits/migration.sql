CREATE TABLE "rate_limit_buckets" (
  "key" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL,
  "reset_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_buckets_reset_at_idx"
ON "rate_limit_buckets"("reset_at");
