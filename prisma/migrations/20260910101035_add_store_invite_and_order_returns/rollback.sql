-- Manual rollback for 20260910101035_add_store_invite_and_order_returns.
-- Prisma has no automatic "down" migration - this is a hand-written, precisely-scoped
-- inverse of migration.sql, kept here for reference. NOT run automatically by any tool.
--
-- DESTRUCTIVE: this drops order_returns, order_return_items, and
-- store_guest_upgrade_requests entirely, and removes users.invited_by_id /
-- users.store_invite_code. Only safe to run before real store-invite data has
-- accumulated (invite codes generated, guests registered, returns filed). After that,
-- running this destroys real records with no way back - roll back application code
-- instead of the schema at that point. Take a fresh DB backup before running this
-- regardless.

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_invited_by_id_foreign`;

-- DropForeignKey
ALTER TABLE `order_returns` DROP FOREIGN KEY `order_returns_order_group_id_foreign`;

-- DropForeignKey
ALTER TABLE `order_return_items` DROP FOREIGN KEY `order_return_items_order_return_id_foreign`;

-- DropForeignKey
ALTER TABLE `store_guest_upgrade_requests` DROP FOREIGN KEY `store_guest_upgrade_requests_user_id_foreign`;

-- DropIndex
DROP INDEX `users_store_invite_code_unique` ON `users`;

-- DropIndex
DROP INDEX `users_invited_by_id_foreign` ON `users`;

-- DropIndex
DROP INDEX `wallets_user_id_type_unique` ON `wallets`;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `invited_by_id`,
    DROP COLUMN `store_invite_code`;

-- AlterTable - only safe if no order_refund/store_invite rows exist yet (see below)
ALTER TABLE `commission_logs` MODIFY `type` ENUM('direct_referral', 'indirect_referral', 'chain_referral', 'region_fallback', 'influencer', 'patron', 'super_admin', 'school_compensation') NOT NULL;

-- DropTable
DROP TABLE `order_return_items`;

-- DropTable
DROP TABLE `order_returns`;

-- DropTable
DROP TABLE `store_guest_upgrade_requests`;

-- Before running the commission_logs ALTER above, this MUST return 0 rows, or the
-- ALTER will fail (existing rows using a value being removed from the enum) or,
-- worse, silently truncate them to empty string depending on SQL mode:
--   SELECT COUNT(*) FROM commission_logs WHERE type IN ('store_invite', 'order_refund');
-- If it's non-zero, either delete/migrate those rows first (data loss) or leave the
-- commission_logs.type enum alone and only revert the rest of this script.
