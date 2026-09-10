-- AlterTable
ALTER TABLE `commission_logs` MODIFY `type` ENUM('direct_referral', 'indirect_referral', 'chain_referral', 'region_fallback', 'influencer', 'patron', 'super_admin', 'school_compensation', 'store_invite', 'order_refund') NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `invited_by_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `store_invite_code` VARCHAR(32) NULL;

-- CreateTable
CREATE TABLE `order_returns` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_group_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `reason` TEXT NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `rejection_reason` TEXT NULL,
    `refunded_amount` DECIMAL(10, 2) NULL,
    `reviewed_by` BIGINT UNSIGNED NULL,
    `reviewed_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `order_returns_order_group_id_foreign`(`order_group_id`),
    INDEX `order_returns_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Note: this table may already exist in this environment if the PHP app's own
-- "create_order_returns_table" migration has actually been run here (unlike the
-- local dev DB this was developed against, where Laravel's migration tracker claimed
-- it ran but the table was missing). If `order_returns` / `order_return_items`
-- already exist with this exact shape, skip those two CREATE TABLE statements below
-- and this one above - see step 2 of the deployment runbook.

-- CreateTable
CREATE TABLE `order_return_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_return_id` BIGINT UNSIGNED NOT NULL,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `quantity` INTEGER NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `order_return_items_order_return_id_foreign`(`order_return_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_guest_upgrade_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('pending', 'completed', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
    `started_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `deadline_at` TIMESTAMP(0) NOT NULL,
    `completed_at` TIMESTAMP(0) NULL,
    `expired_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `store_guest_upgrade_requests_user_id_foreign`(`user_id`),
    INDEX `store_guest_upgrade_requests_status_deadline_index`(`status`, `deadline_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `users_store_invite_code_unique` ON `users`(`store_invite_code`);

-- CreateIndex
CREATE INDEX `users_invited_by_id_foreign` ON `users`(`invited_by_id`);

-- CreateIndex
-- If this fails with a duplicate-key error, STOP - see step 1 of the deployment
-- runbook. Do not skip this index; the commission-credit code depends on it.
CREATE UNIQUE INDEX `wallets_user_id_type_unique` ON `wallets`(`user_id`, `type`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_invited_by_id_foreign` FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_returns` ADD CONSTRAINT `order_returns_order_group_id_foreign` FOREIGN KEY (`order_group_id`) REFERENCES `order_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_return_items` ADD CONSTRAINT `order_return_items_order_return_id_foreign` FOREIGN KEY (`order_return_id`) REFERENCES `order_returns`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `store_guest_upgrade_requests` ADD CONSTRAINT `store_guest_upgrade_requests_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- Seed the two new admin-configurable settings this feature reads. Idempotent -
-- safe to run even if a row with this key already exists (e.g. re-running this
-- migration file by hand). Values are placeholders (5%, 72h) - change them
-- afterward via the PHP admin settings panel, not by editing this file.
INSERT INTO `settings` (`name`, `key`, `data_type`, `value`, `created_at`, `updated_at`)
SELECT 'Store Invite Commission (%)', 'store_invite_commission_percentage', 'number', '5', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'store_invite_commission_percentage');

INSERT INTO `settings` (`name`, `key`, `data_type`, `value`, `created_at`, `updated_at`)
SELECT 'Store Guest Upgrade Window (hours)', 'store_invite_upgrade_window_hours', 'number', '72', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'store_invite_upgrade_window_hours');
