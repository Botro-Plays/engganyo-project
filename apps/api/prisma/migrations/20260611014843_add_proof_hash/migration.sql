-- AlterTable
ALTER TABLE "task_completions" ADD COLUMN     "proof_hash" TEXT;

-- CreateIndex
CREATE INDEX "task_completions_proof_hash_idx" ON "task_completions"("proof_hash");
