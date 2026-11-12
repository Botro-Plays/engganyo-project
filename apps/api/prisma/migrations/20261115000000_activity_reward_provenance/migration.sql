-- Add ACTIVITY_REWARD provenance for verified-activity item grants.
-- No existing rows are reclassified; the value is unused until a grant
-- path explicitly opts in and the catalog item carries the
-- metadata.activityRewardTradable whitelist flag.
ALTER TYPE "InventoryProvenance" ADD VALUE 'ACTIVITY_REWARD';
