-- AlterEnum: Add TrustPilot and Google Business review task types
ALTER TYPE "TaskType" ADD VALUE 'TRUSTPILOT_REVIEW';
ALTER TYPE "TaskType" ADD VALUE 'GOOGLE_REVIEW';
