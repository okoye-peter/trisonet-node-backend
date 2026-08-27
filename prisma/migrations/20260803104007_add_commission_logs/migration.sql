-- CreateTable
CREATE TABLE `commission_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `recipient_id` BIGINT UNSIGNED NULL,
    `source_user_id` BIGINT UNSIGNED NULL,
    `type` ENUM('direct_referral', 'indirect_referral', 'chain_referral', 'region_fallback', 'influencer', 'patron', 'super_admin', 'school_compensation') NOT NULL,
    `status` ENUM('success', 'failed', 'skipped') NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `wallet_type` ENUM('direct', 'indirect', 'central_treasury', 'patronage', 'earning') NULL,
    `level` INTEGER NULL,
    `reason` VARCHAR(500) NULL,
    `reference` VARCHAR(255) NULL,
    `processed_via` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `commission_logs_recipient_id_foreign`(`recipient_id`),
    INDEX `commission_logs_source_user_id_foreign`(`source_user_id`),
    INDEX `commission_logs_reference_index`(`reference`),
    INDEX `commission_logs_status_index`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_recipient_id_foreign` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_source_user_id_foreign` FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
