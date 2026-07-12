CREATE TABLE "ai_usage_events" (
    "id" VARCHAR(256) NOT NULL,
    "job_id" VARCHAR(256) NOT NULL,
    "provider_id" VARCHAR(128) NOT NULL,
    "model_id" VARCHAR(128) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_events_job_id_created_at_idx"
ON "ai_usage_events"("job_id", "created_at");

CREATE INDEX "ai_usage_events_model_id_created_at_idx"
ON "ai_usage_events"("model_id", "created_at");

ALTER TABLE "ai_usage_events"
ADD CONSTRAINT "ai_usage_events_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "agent_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_usage_events"
ADD CONSTRAINT "ai_usage_events_token_counts_nonnegative"
CHECK (
  "input_tokens" >= 0 AND
  "output_tokens" >= 0 AND
  "total_tokens" >= 0 AND
  "total_tokens" >= "input_tokens" + "output_tokens"
);
