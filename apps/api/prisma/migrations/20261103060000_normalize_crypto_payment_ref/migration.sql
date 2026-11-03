-- Normalize crypto deposit payment references to lowercase.
-- EVM transaction hashes are case-insensitive, but the payment_ref unique
-- column compares case-sensitively, so casing variants (0xAB.. vs 0xab..)
-- could bypass the uniqueness guard and let one transaction settle two
-- deposits. Lowercasing all existing values makes the constraint effective.
--
-- If this statement would collide (two rows differing only by case), it fails
-- loudly — that collision means a real double-claim already happened and
-- needs manual review, not silent data loss.
UPDATE "deposits"
SET "payment_ref" = lower("payment_ref")
WHERE "payment_ref" IS NOT NULL
  AND "method" IN ('USDT_BEP20', 'USDT_BASE');

-- Same normalization for declared paying wallets so string comparisons
-- against the on-chain Transfer `from` are consistent.
UPDATE "deposits"
SET "user_wallet_address" = lower("user_wallet_address")
WHERE "user_wallet_address" IS NOT NULL
  AND "method" IN ('USDT_BEP20', 'USDT_BASE');
