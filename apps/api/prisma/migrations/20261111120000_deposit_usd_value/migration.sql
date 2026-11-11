-- Immutable USD valuation snapshot captured at deposit initiation.
-- completeDeposit uses this (not the live DepositPackage.usdAmount, which
-- admins can edit) to compute VP, so a package price change after
-- initiation cannot alter an in-flight deposit's reward.
ALTER TABLE "deposits" ADD COLUMN "usd_value" DOUBLE PRECISION;
