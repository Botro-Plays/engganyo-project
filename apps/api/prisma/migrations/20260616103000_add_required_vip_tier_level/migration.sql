-- Add required_vip_tier_level column to store_items
-- NULL means no VIP requirement (all users can purchase)
ALTER TABLE store_items ADD COLUMN required_vip_tier_level INTEGER NULL;
