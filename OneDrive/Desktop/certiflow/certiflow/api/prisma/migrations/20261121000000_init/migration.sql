
CREATE TYPE "Role" AS ENUM ('CENTRE', 'OFFICER', 'QUALITY', 'STATE');

CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'DISTRICT_REVIEW', 'QUALITY_REVIEW', 'STATE_REVIEW', 'SENT_BACK', 'REJECTED', 'APPROVED');


CREATE TYPE "Stage" AS ENUM ('DISTRICT', 'QUALITY', 'STATE');


CREATE TYPE "CertStatus" AS ENUM ('VALID', 'REVOKED');


CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');


CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Centre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,

    CONSTRAINT "Centre_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "districtId" TEXT,
    "centreId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "round" INTEGER NOT NULL DEFAULT 1,
    "lastReason" TEXT,
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "candidateId" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "downloadToken" TEXT NOT NULL,
    "status" "CertStatus" NOT NULL DEFAULT 'VALID',
    "revokedReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "pdfPath" TEXT,
    "delivery" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "batchId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);


CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "message" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);


CREATE INDEX "Batch_status_idx" ON "Batch"("status");


CREATE INDEX "Candidate_batchId_idx" ON "Candidate"("batchId");


CREATE UNIQUE INDEX "Approval_batchId_userId_stage_round_key" ON "Approval"("batchId", "userId", "stage", "round");


CREATE UNIQUE INDEX "Certificate_seq_key" ON "Certificate"("seq");


CREATE UNIQUE INDEX "Certificate_candidateId_key" ON "Certificate"("candidateId");


CREATE UNIQUE INDEX "Certificate_downloadToken_key" ON "Certificate"("downloadToken");


CREATE INDEX "AuditLog_batchId_idx" ON "AuditLog"("batchId");

CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");


CREATE INDEX "Notification_role_createdAt_idx" ON "Notification"("role", "createdAt");


ALTER TABLE "Centre" ADD CONSTRAINT "Centre_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "User" ADD CONSTRAINT "User_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "User" ADD CONSTRAINT "User_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "Batch" ADD CONSTRAINT "Batch_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Approval" ADD CONSTRAINT "Approval_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
