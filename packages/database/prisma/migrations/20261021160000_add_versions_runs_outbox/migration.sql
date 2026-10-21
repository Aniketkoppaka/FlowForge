-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NodeExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD_LETTER');

-- AlterTable
ALTER TABLE "Workflow"
ADD COLUMN "publishedVersionId" UUID,
ADD COLUMN "publishedVersionNumber" INTEGER;

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflowId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflowId" UUID NOT NULL,
    "workflowVersionId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerPayload" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" VARCHAR(128),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "workerLeaseOwner" VARCHAR(128),
    "workerLeaseUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeExecution" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "nodeId" VARCHAR(100) NOT NULL,
    "nodeType" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "status" "NodeExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "selectedBranch" VARCHAR(16),
    "skipReason" TEXT,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "workerId" VARCHAR(128) NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" JSONB,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventType" VARCHAR(64) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" VARCHAR(128),
    "lockedUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_versionNumber_key" ON "WorkflowVersion"("workflowId", "versionNumber");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_contentHash_idx" ON "WorkflowVersion"("workflowId", "contentHash");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_createdAt_idx" ON "WorkflowVersion"("workflowId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_userId_workflowId_idempotencyKey_key" ON "WorkflowRun"("userId", "workflowId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_userId_createdAt_idx" ON "WorkflowRun"("workflowId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkflowRun_userId_createdAt_idx" ON "WorkflowRun"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkflowRun_status_workerLeaseUntil_idx" ON "WorkflowRun"("status", "workerLeaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "NodeExecution_runId_nodeId_key" ON "NodeExecution"("runId", "nodeId");

-- CreateIndex
CREATE INDEX "NodeExecution_runId_createdAt_idx" ON "NodeExecution"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionAttempt_runId_attemptNumber_key" ON "ExecutionAttempt"("runId", "attemptNumber");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_runId_idx" ON "ExecutionAttempt"("runId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_lockedUntil_idx" ON "OutboxEvent"("status", "nextAttemptAt", "lockedUntil");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_idx" ON "OutboxEvent"("aggregateId");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeExecution" ADD CONSTRAINT "NodeExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
