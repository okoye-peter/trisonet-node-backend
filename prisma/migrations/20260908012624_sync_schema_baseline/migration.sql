-- DropForeignKey
ALTER TABLE `commission_logs` DROP FOREIGN KEY `commission_logs_recipient_id_foreign`;

-- DropForeignKey
ALTER TABLE `commission_logs` DROP FOREIGN KEY `commission_logs_source_user_id_foreign`;

-- AlterTable
ALTER TABLE `activation_cards` ADD COLUMN `acknowledged_at` TIMESTAMP(0) NULL;

-- AlterTable
ALTER TABLE `commission_logs` MODIFY `wallet_type` ENUM('direct', 'indirect', 'central_treasury', 'patronage', 'earning', 'shopping') NULL;

-- AlterTable
ALTER TABLE `order_transactions` ADD COLUMN `confirmed_at` TIMESTAMP(0) NULL,
    ADD COLUMN `payment_details` JSON NULL,
    ADD COLUMN `payment_reference` VARCHAR(255) NULL,
    ADD COLUMN `payment_status` ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `patron_plans` ADD COLUMN `earning_percentage` DOUBLE NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `created_by` BIGINT UNSIGNED NULL,
    ADD COLUMN `is_returnable` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `review_comment` TEXT NULL,
    ADD COLUMN `reviewed_at` TIMESTAMP(0) NULL,
    ADD COLUMN `reviewed_by` BIGINT UNSIGNED NULL,
    ADD COLUMN `status` TINYINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `is_worker` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `nin` VARCHAR(255) NULL,
    ADD COLUMN `nin_hash` VARCHAR(255) NULL,
    ADD COLUMN `plan_id` BIGINT UNSIGNED NULL;

-- AlterTable
ALTER TABLE `wallets` MODIFY `type` ENUM('direct', 'indirect', 'central_treasury', 'patronage', 'earning', 'shopping') NULL;

-- AlterTable
ALTER TABLE `withdrawal_requests` ADD COLUMN `denial_reason` TEXT NULL;

-- CreateTable
CREATE TABLE `auction_listings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `seller_wallet_id` BIGINT UNSIGNED NOT NULL,
    `gkwth_amount` DOUBLE NOT NULL,
    `starting_bid` DOUBLE NOT NULL,
    `buy_it_now_price` DOUBLE NULL,
    `min_increment` DOUBLE NOT NULL DEFAULT 1000,
    `visibility` ENUM('public', 'followers', 'private') NOT NULL DEFAULT 'public',
    `status` ENUM('scheduled', 'active', 'ended', 'awaiting_payment', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
    `starts_at` TIMESTAMP(0) NOT NULL,
    `ends_at` TIMESTAMP(0) NOT NULL,
    `accepted_bid_id` BIGINT UNSIGNED NULL,
    `settlement_type` ENUM('accepted_bid', 'buy_it_now', 'cron_auto_accept', 'ended_early') NULL,
    `claim_deadline_at` TIMESTAMP(0) NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `auction_listings_seller_id_foreign`(`seller_id`),
    INDEX `auction_listings_seller_wallet_id_foreign`(`seller_wallet_id`),
    INDEX `auction_listings_status_ends_at_index`(`status`, `ends_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auction_bids` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `auction_listing_id` BIGINT UNSIGNED NOT NULL,
    `bidder_id` BIGINT UNSIGNED NOT NULL,
    `bidder_wallet_id` BIGINT UNSIGNED NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` ENUM('pending', 'accepted', 'rejected', 'superseded', 'refunded') NOT NULL DEFAULT 'pending',
    `is_buy_it_now` BOOLEAN NOT NULL DEFAULT false,
    `refunded_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `auction_bids_listing_id_status_index`(`auction_listing_id`, `status`),
    INDEX `auction_bids_bidder_id_foreign`(`bidder_id`),
    INDEX `auction_bids_bidder_wallet_id_foreign`(`bidder_wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auction_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `auction_listing_id` BIGINT UNSIGNED NOT NULL,
    `winning_bid_id` BIGINT UNSIGNED NULL,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `buyer_id` BIGINT UNSIGNED NOT NULL,
    `gkwth_amount` DOUBLE NOT NULL,
    `gross_amount` DOUBLE NOT NULL,
    `platform_fee` DOUBLE NOT NULL,
    `net_amount` DOUBLE NOT NULL,
    `settlement_type` ENUM('accepted_bid', 'buy_it_now', 'cron_auto_accept', 'ended_early') NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `auction_transactions_reference_unique`(`reference`),
    INDEX `auction_transactions_listing_id_foreign`(`auction_listing_id`),
    INDEX `auction_transactions_seller_id_index`(`seller_id`),
    INDEX `auction_transactions_buyer_id_index`(`buyer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auction_reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `auction_listing_id` BIGINT UNSIGNED NOT NULL,
    `reviewer_id` BIGINT UNSIGNED NOT NULL,
    `seller_id` BIGINT UNSIGNED NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `auction_reviews_seller_id_index`(`seller_id`),
    UNIQUE INDEX `auction_reviews_listing_reviewer_unique`(`auction_listing_id`, `reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auction_claims` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `auction_listing_id` BIGINT UNSIGNED NOT NULL,
    `bid_id` BIGINT UNSIGNED NOT NULL,
    `buyer_id` BIGINT UNSIGNED NOT NULL,
    `amount` DOUBLE NOT NULL,
    `transfer_amount` DOUBLE NULL,
    `reference` VARCHAR(255) NOT NULL,
    `status` ENUM('pending', 'paid', 'expired') NOT NULL DEFAULT 'pending',
    `account_name` VARCHAR(255) NULL,
    `bank_name` VARCHAR(255) NULL,
    `account_number` VARCHAR(255) NULL,
    `expires_at` TIMESTAMP(0) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `auction_claims_reference_unique`(`reference`),
    INDEX `auction_claims_listing_id_foreign`(`auction_listing_id`),
    INDEX `auction_claims_buyer_id_index`(`buyer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_penalties` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `penalized_by` BIGINT UNSIGNED NOT NULL,
    `payroll_transaction_id` BIGINT UNSIGNED NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'applied') NOT NULL DEFAULT 'pending',
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `employee_penalties_employee_id_foreign`(`employee_id`),
    INDEX `employee_penalties_payroll_transaction_id_foreign`(`payroll_transaction_id`),
    INDEX `employee_penalties_penalized_by_foreign`(`penalized_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(255) NULL,
    `position` VARCHAR(255) NULL,
    `department` VARCHAR(255) NULL,
    `salary` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `bank_uuid` VARCHAR(255) NOT NULL,
    `bank_name` VARCHAR(255) NOT NULL,
    `bank_code` VARCHAR(255) NULL,
    `bank_account_number` VARCHAR(255) NOT NULL,
    `account_name` VARCHAR(255) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_upgrade_supports` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `bank_name` VARCHAR(255) NOT NULL,
    `bank_code` VARCHAR(255) NULL,
    `account_number` VARCHAR(11) NOT NULL,
    `account_name` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
    `reference` VARCHAR(255) NULL,
    `denial_reason` TEXT NULL,
    `approved_by` BIGINT UNSIGNED NULL,
    `approved_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `infant_upgrade_supports_approved_by_foreign`(`approved_by`),
    INDEX `infant_upgrade_supports_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `queue` VARCHAR(255) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `attempts` TINYINT UNSIGNED NOT NULL,
    `reserved_at` INTEGER UNSIGNED NULL,
    `available_at` INTEGER UNSIGNED NOT NULL,
    `created_at` INTEGER UNSIGNED NOT NULL,

    INDEX `jobs_queue_index`(`queue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `paid_by` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `paga_transaction_id` VARCHAR(255) NULL,
    `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `narration` VARCHAR(255) NULL,
    `paga_response` JSON NULL,
    `paid_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `payroll_transactions_reference_unique`(`reference`),
    INDEX `payroll_transactions_employee_id_foreign`(`employee_id`),
    INDEX `payroll_transactions_paid_by_foreign`(`paid_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worker_penalties` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `penalized_by` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('pending', 'applied') NOT NULL DEFAULT 'pending',
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `worker_penalties_penalized_by_foreign`(`penalized_by`),
    INDEX `worker_penalties_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_images` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `image` VARCHAR(255) NOT NULL,
    `cloudinary_public_id` VARCHAR(255) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `product_images_product_id_foreign`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_shop_orders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `ref_no` VARCHAR(255) NOT NULL,
    `payment_reference` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `items` JSON NOT NULL,
    `shipping` JSON NOT NULL,
    `payment_details` JSON NULL,
    `status` ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending',
    `order_group_id` BIGINT UNSIGNED NULL,
    `confirmed_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `pending_shop_orders_ref_no_unique`(`ref_no`),
    UNIQUE INDEX `pending_shop_orders_payment_reference_unique`(`payment_reference`),
    UNIQUE INDEX `pending_shop_orders_order_group_id_unique`(`order_group_id`),
    INDEX `pending_shop_orders_user_id_foreign`(`user_id`),
    INDEX `pending_shop_orders_order_group_id_foreign`(`order_group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_notices` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `audience` VARCHAR(255) NOT NULL DEFAULT 'all',
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_notice_user` (
    `admin_notice_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `read_at` TIMESTAMP(0) NULL,

    INDEX `admin_notice_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`admin_notice_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patron_activation_payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `amount` DOUBLE NOT NULL,
    `charges` DOUBLE NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 0,
    `reference` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `patron_activation_payments_reference_unique`(`reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_patron_activation_pivot_table` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `patron_activation_payment_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `upapt_user_id_foreign`(`user_id`),
    INDEX `upapt_patron_activation_payment_id_foreign`(`patron_activation_payment_id`),
    PRIMARY KEY (`user_id`, `patron_activation_payment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `model_id` VARCHAR(191) NOT NULL,
    `old_values` JSON NULL,
    `new_values` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `endpoint` VARCHAR(255) NULL,

    INDEX `audit_logs_model_model_id_idx`(`model`, `model_id`),
    INDEX `audit_logs_user_id_fkey`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `order_transactions_payment_reference_key` ON `order_transactions`(`payment_reference`);

-- CreateIndex
CREATE UNIQUE INDEX `users_nin_hash_unique` ON `users`(`nin_hash`);

-- CreateIndex
CREATE INDEX `users_patron_plan_id_index` ON `users`(`plan_id`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_patron_plan_id_foreign` FOREIGN KEY (`plan_id`) REFERENCES `patron_plans`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_listings` ADD CONSTRAINT `auction_listings_seller_id_foreign` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_listings` ADD CONSTRAINT `auction_listings_seller_wallet_id_foreign` FOREIGN KEY (`seller_wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_bids` ADD CONSTRAINT `auction_bids_auction_listing_id_foreign` FOREIGN KEY (`auction_listing_id`) REFERENCES `auction_listings`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_bids` ADD CONSTRAINT `auction_bids_bidder_id_foreign` FOREIGN KEY (`bidder_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_bids` ADD CONSTRAINT `auction_bids_bidder_wallet_id_foreign` FOREIGN KEY (`bidder_wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_transactions` ADD CONSTRAINT `auction_transactions_listing_id_foreign` FOREIGN KEY (`auction_listing_id`) REFERENCES `auction_listings`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_reviews` ADD CONSTRAINT `auction_reviews_listing_id_foreign` FOREIGN KEY (`auction_listing_id`) REFERENCES `auction_listings`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `auction_claims` ADD CONSTRAINT `auction_claims_listing_id_foreign` FOREIGN KEY (`auction_listing_id`) REFERENCES `auction_listings`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_penalties` ADD CONSTRAINT `employee_penalties_employee_id_foreign` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_penalties` ADD CONSTRAINT `employee_penalties_payroll_transaction_id_foreign` FOREIGN KEY (`payroll_transaction_id`) REFERENCES `payroll_transactions`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `employee_penalties` ADD CONSTRAINT `employee_penalties_penalized_by_foreign` FOREIGN KEY (`penalized_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_upgrade_supports` ADD CONSTRAINT `infant_upgrade_supports_approved_by_foreign` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_upgrade_supports` ADD CONSTRAINT `infant_upgrade_supports_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payroll_transactions` ADD CONSTRAINT `payroll_transactions_employee_id_foreign` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payroll_transactions` ADD CONSTRAINT `payroll_transactions_paid_by_foreign` FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `worker_penalties` ADD CONSTRAINT `worker_penalties_penalized_by_foreign` FOREIGN KEY (`penalized_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `worker_penalties` ADD CONSTRAINT `worker_penalties_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_recipient_id_foreign` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_source_user_id_foreign` FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_product_id_foreign` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `pending_shop_orders` ADD CONSTRAINT `pending_shop_orders_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `pending_shop_orders` ADD CONSTRAINT `pending_shop_orders_order_group_id_foreign` FOREIGN KEY (`order_group_id`) REFERENCES `order_groups`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `admin_notice_user` ADD CONSTRAINT `admin_notice_user_admin_notice_id_fkey` FOREIGN KEY (`admin_notice_id`) REFERENCES `admin_notices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_notice_user` ADD CONSTRAINT `admin_notice_user_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_patron_activation_pivot_table` ADD CONSTRAINT `upapt_patron_activation_payment_id_foreign` FOREIGN KEY (`patron_activation_payment_id`) REFERENCES `patron_activation_payments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_patron_activation_pivot_table` ADD CONSTRAINT `upapt_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

