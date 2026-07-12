-- Store the fully validated provider-neutral lifecycle snapshot for durable job recovery.
-- The normalized incident, scan, plan, simulation, and transition records remain canonical
-- for querying and reporting. This JSON contains no wallet secrets, signatures, or calldata.
ALTER TABLE "agent_jobs" ADD COLUMN "state" JSONB;
