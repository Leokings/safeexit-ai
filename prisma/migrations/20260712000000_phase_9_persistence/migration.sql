-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('RECEIVED', 'WAITING_FOR_SOURCE', 'ANALYSING', 'PLAN_READY', 'WAITING_FOR_USER', 'SIGNING', 'EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('DETECTED', 'SUPPORTED', 'UNSUPPORTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('NATIVE', 'ERC20', 'ERC721', 'ERC1155');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('ERC20_ALLOWANCE', 'ERC721_TOKEN', 'NFT_OPERATOR');

-- CreateEnum
CREATE TYPE "RescuePlanStatus" AS ENUM ('DRAFT', 'READY', 'PARTIAL', 'STALE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RescueActionType" AS ENUM ('TRANSFER_NATIVE', 'TRANSFER_ERC20', 'TRANSFER_ERC721', 'TRANSFER_ERC1155', 'REVOKE_ERC20_APPROVAL', 'REVOKE_NFT_OPERATOR', 'CLAIM_SUPPORTED_AIRDROP', 'WITHDRAW_SUPPORTED_POSITION', 'CUSTOM_SUPPORTED_ADAPTER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionSimulationStatus" AS ENUM ('NOT_SIMULATED', 'PASSED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('SUCCEEDED', 'REVERTED', 'UNSUPPORTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ExecutionAttemptStatus" AS ENUM ('CREATED', 'WAITING_FOR_SIGNATURE', 'SUBMITTED', 'CONFIRMED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('RECEIVED', 'WAITING_FOR_SOURCE', 'ANALYSING', 'PLAN_READY', 'WAITING_FOR_USER', 'SIGNING', 'EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "incidents" (
    "id" VARCHAR(256) NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "source_address" VARCHAR(42) NOT NULL,
    "destination_address" VARCHAR(42) NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "ownership_statement_version" VARCHAR(32) NOT NULL,
    "ownership_attested_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_scans" (
    "id" VARCHAR(256) NOT NULL,
    "incident_id" VARCHAR(256) NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "provider_id" VARCHAR(128) NOT NULL,
    "observed_at_block" DECIMAL(78,0) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "wallet_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" VARCHAR(256) NOT NULL,
    "scan_id" VARCHAR(256) NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "owner_address" VARCHAR(42) NOT NULL,
    "support_status" "SupportStatus" NOT NULL,
    "observed_at_block" DECIMAL(78,0) NOT NULL,
    "discovery_source" VARCHAR(128) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "contract_address" VARCHAR(42),
    "token_id" DECIMAL(78,0),
    "name" VARCHAR(128),
    "symbol" VARCHAR(32),
    "decimals" INTEGER,
    "balance" DECIMAL(78,0),
    "estimated_value_usd" DECIMAL(38,8),
    "valuation_source" VARCHAR(128),
    "valuation_observed_at" TIMESTAMPTZ(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" VARCHAR(256) NOT NULL,
    "scan_id" VARCHAR(256) NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "owner_address" VARCHAR(42) NOT NULL,
    "support_status" "SupportStatus" NOT NULL,
    "observed_at_block" DECIMAL(78,0) NOT NULL,
    "discovery_source" VARCHAR(128) NOT NULL,
    "approval_type" "ApprovalType" NOT NULL,
    "token_address" VARCHAR(42),
    "collection_address" VARCHAR(42),
    "spender_address" VARCHAR(42),
    "operator_address" VARCHAR(42),
    "token_id" DECIMAL(78,0),
    "amount" DECIMAL(78,0),
    "standard" VARCHAR(16),
    "approved" BOOLEAN,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_plans" (
    "id" VARCHAR(256) NOT NULL,
    "incident_id" VARCHAR(256) NOT NULL,
    "version" INTEGER NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "source_address" VARCHAR(42) NOT NULL,
    "destination_address" VARCHAR(42) NOT NULL,
    "observed_at_block" DECIMAL(78,0) NOT NULL,
    "status" "RescuePlanStatus" NOT NULL,
    "omissions" JSONB NOT NULL DEFAULT '[]',
    "integrity_hash" CHAR(66) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rescue_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_actions" (
    "id" VARCHAR(256) NOT NULL,
    "plan_id" VARCHAR(256) NOT NULL,
    "position" INTEGER NOT NULL,
    "chain_id" BIGINT NOT NULL,
    "source_address" VARCHAR(42) NOT NULL,
    "action_type" "RescueActionType" NOT NULL,
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expected_effects" JSONB NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "estimated_value_usd" DECIMAL(38,8),
    "support_status" "SupportStatus" NOT NULL,
    "simulation_status" "ActionSimulationStatus" NOT NULL,
    "parameters" JSONB NOT NULL,

    CONSTRAINT "rescue_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" VARCHAR(256) NOT NULL,
    "plan_id" VARCHAR(256) NOT NULL,
    "action_id" VARCHAR(256) NOT NULL,
    "provider_id" VARCHAR(128) NOT NULL,
    "status" "SimulationStatus" NOT NULL,
    "plan_hash" CHAR(66) NOT NULL,
    "observed_at_block" DECIMAL(78,0) NOT NULL,
    "gas_estimate" DECIMAL(78,0),
    "expected_effects" JSONB NOT NULL,
    "asset_changes" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failure_reason" VARCHAR(1000),
    "simulated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_attempts" (
    "id" VARCHAR(256) NOT NULL,
    "incident_id" VARCHAR(256) NOT NULL,
    "plan_id" VARCHAR(256) NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "ExecutionAttemptStatus" NOT NULL,
    "transaction_hash" CHAR(66),
    "submitted_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(128),
    "error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "execution_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" VARCHAR(256) NOT NULL,
    "request_id" VARCHAR(256),
    "incident_id" VARCHAR(256),
    "service" VARCHAR(64) NOT NULL,
    "status" "AgentJobStatus" NOT NULL,
    "dashboard_url" VARCHAR(2048),
    "result_summary" VARCHAR(2000),
    "error_code" VARCHAR(128),
    "error_message" VARCHAR(1000),
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_job_transitions" (
    "job_id" VARCHAR(256) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_status" "AgentJobStatus",
    "to_status" "AgentJobStatus" NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_job_transitions_pkey" PRIMARY KEY ("job_id","sequence")
);

-- CreateIndex
CREATE INDEX "incidents_chain_id_source_address_idx" ON "incidents"("chain_id", "source_address");

-- CreateIndex
CREATE INDEX "wallet_scans_incident_id_observed_at_idx" ON "wallet_scans"("incident_id", "observed_at");

-- CreateIndex
CREATE INDEX "assets_scan_id_asset_type_idx" ON "assets"("scan_id", "asset_type");

-- CreateIndex
CREATE INDEX "assets_chain_id_owner_address_idx" ON "assets"("chain_id", "owner_address");

-- CreateIndex
CREATE INDEX "approvals_scan_id_approval_type_idx" ON "approvals"("scan_id", "approval_type");

-- CreateIndex
CREATE INDEX "approvals_chain_id_owner_address_idx" ON "approvals"("chain_id", "owner_address");

-- CreateIndex
CREATE INDEX "rescue_plans_incident_id_created_at_idx" ON "rescue_plans"("incident_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rescue_plans_incident_id_version_key" ON "rescue_plans"("incident_id", "version");

-- CreateIndex
CREATE INDEX "rescue_actions_plan_id_action_type_idx" ON "rescue_actions"("plan_id", "action_type");

-- CreateIndex
CREATE UNIQUE INDEX "rescue_actions_plan_id_position_key" ON "rescue_actions"("plan_id", "position");

-- CreateIndex
CREATE INDEX "simulations_plan_id_status_idx" ON "simulations"("plan_id", "status");

-- CreateIndex
CREATE INDEX "simulations_action_id_simulated_at_idx" ON "simulations"("action_id", "simulated_at");

-- CreateIndex
CREATE INDEX "execution_attempts_incident_id_status_idx" ON "execution_attempts"("incident_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "execution_attempts_plan_id_attempt_number_key" ON "execution_attempts"("plan_id", "attempt_number");

-- CreateIndex
CREATE INDEX "agent_jobs_incident_id_status_idx" ON "agent_jobs"("incident_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_jobs_request_id_key" ON "agent_jobs"("request_id");

-- AddForeignKey
ALTER TABLE "wallet_scans" ADD CONSTRAINT "wallet_scans_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "wallet_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "wallet_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_plans" ADD CONSTRAINT "rescue_plans_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rescue_actions" ADD CONSTRAINT "rescue_actions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "rescue_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "rescue_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "rescue_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "rescue_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_job_transitions" ADD CONSTRAINT "agent_job_transitions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "agent_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants that complement application-level Zod validation.
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "incidents_distinct_addresses" CHECK (lower("source_address") <> lower("destination_address")),
  ADD CONSTRAINT "incidents_source_address_format" CHECK ("source_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT "incidents_destination_address_format" CHECK ("destination_address" ~ '^0x[0-9A-Fa-f]{40}$');

ALTER TABLE "wallet_scans"
  ALTER COLUMN "warnings" SET NOT NULL,
  ADD CONSTRAINT "wallet_scans_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "wallet_scans_address_format" CHECK ("address" ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT "wallet_scans_block_nonnegative" CHECK ("observed_at_block" >= 0);

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "assets_owner_address_format" CHECK ("owner_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT "assets_contract_address_format" CHECK ("contract_address" IS NULL OR "contract_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT "assets_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  ADD CONSTRAINT "assets_shape" CHECK (
    ("asset_type" = 'NATIVE' AND "contract_address" IS NULL AND "token_id" IS NULL AND "symbol" IS NOT NULL AND "decimals" IS NOT NULL AND "balance" IS NOT NULL)
    OR ("asset_type" = 'ERC20' AND "contract_address" IS NOT NULL AND "token_id" IS NULL AND "name" IS NOT NULL AND "symbol" IS NOT NULL AND "decimals" IS NOT NULL AND "balance" IS NOT NULL)
    OR ("asset_type" = 'ERC721' AND "contract_address" IS NOT NULL AND "token_id" IS NOT NULL)
    OR ("asset_type" = 'ERC1155' AND "contract_address" IS NOT NULL AND "token_id" IS NOT NULL AND "balance" IS NOT NULL)
  );

ALTER TABLE "approvals"
  ADD CONSTRAINT "approvals_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "approvals_owner_address_format" CHECK ("owner_address" ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT "approvals_shape" CHECK (
    ("approval_type" = 'ERC20_ALLOWANCE' AND "token_address" IS NOT NULL AND "spender_address" IS NOT NULL AND "amount" IS NOT NULL)
    OR ("approval_type" = 'ERC721_TOKEN' AND "collection_address" IS NOT NULL AND "operator_address" IS NOT NULL AND "token_id" IS NOT NULL)
    OR ("approval_type" = 'NFT_OPERATOR' AND "collection_address" IS NOT NULL AND "operator_address" IS NOT NULL AND "standard" IN ('ERC721', 'ERC1155') AND "approved" IS NOT NULL)
  );

ALTER TABLE "rescue_plans"
  ADD CONSTRAINT "rescue_plans_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "rescue_plans_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "rescue_plans_distinct_addresses" CHECK (lower("source_address") <> lower("destination_address")),
  ADD CONSTRAINT "rescue_plans_block_nonnegative" CHECK ("observed_at_block" >= 0),
  ADD CONSTRAINT "rescue_plans_integrity_hash_format" CHECK ("integrity_hash" ~ '^0x[0-9A-Fa-f]{64}$');

ALTER TABLE "rescue_actions"
  ALTER COLUMN "dependencies" SET NOT NULL,
  ALTER COLUMN "evidence_ids" SET NOT NULL,
  ADD CONSTRAINT "rescue_actions_position_nonnegative" CHECK ("position" >= 0),
  ADD CONSTRAINT "rescue_actions_chain_id_positive" CHECK ("chain_id" > 0),
  ADD CONSTRAINT "rescue_actions_source_address_format" CHECK ("source_address" ~ '^0x[0-9A-Fa-f]{40}$');

ALTER TABLE "simulations"
  ALTER COLUMN "warnings" SET NOT NULL,
  ADD CONSTRAINT "simulations_hash_format" CHECK ("plan_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "simulations_failure_reason_required" CHECK ("status" = 'SUCCEEDED' OR "failure_reason" IS NOT NULL),
  ADD CONSTRAINT "simulations_expiry_after_simulation" CHECK ("expires_at" >= "simulated_at");

ALTER TABLE "execution_attempts"
  ADD CONSTRAINT "execution_attempts_number_positive" CHECK ("attempt_number" > 0),
  ADD CONSTRAINT "execution_attempts_hash_format" CHECK ("transaction_hash" IS NULL OR "transaction_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT "execution_attempts_submission_fields" CHECK ("status" NOT IN ('SUBMITTED', 'CONFIRMED') OR ("transaction_hash" IS NOT NULL AND "submitted_at" IS NOT NULL)),
  ADD CONSTRAINT "execution_attempts_confirmation_fields" CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL),
  ADD CONSTRAINT "execution_attempts_failure_fields" CHECK ("status" <> 'FAILED' OR "error_code" IS NOT NULL);

ALTER TABLE "agent_jobs"
  ADD CONSTRAINT "agent_jobs_revision_nonnegative" CHECK ("revision" >= 0);
