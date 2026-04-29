-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `patron_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(255) NOT NULL,
    `username` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(255) NULL,
    `picture_url` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NULL,
    `region_id` BIGINT UNSIGNED NULL,
    `role` INTEGER NOT NULL DEFAULT 3,
    `account_state` INTEGER NOT NULL DEFAULT 1,
    `country` VARCHAR(255) NULL,
    `referral_id` BIGINT UNSIGNED NULL,
    `email_verification_code` VARCHAR(255) NULL,
    `email_verification_code_sent_at` TIMESTAMP(0) NULL,
    `email_verified_at` TIMESTAMP(0) NULL,
    `password` VARCHAR(255) NOT NULL,
    `password_reset_otp` VARCHAR(255) NULL,
    `password_reset_otp_sent_at` TIMESTAMP(0) NULL,
    `remember_token` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `status` BOOLEAN NOT NULL DEFAULT false,
    `withdrawal_pin` VARCHAR(255) NULL,
    `withdrawal_pin_reset_otp` VARCHAR(255) NULL,
    `withdrawal_pin_reset_otp_sent_at` TIMESTAMP(0) NULL,
    `referral_activate_at` TIMESTAMP(0) NULL,
    `bank` VARCHAR(255) NULL,
    `account_number` VARCHAR(11) NULL,
    `is_infant` BOOLEAN NOT NULL DEFAULT false,
    `birth_date` DATE NULL,
    `birth_place` VARCHAR(255) NULL,
    `birth_certificate` VARCHAR(255) NULL,
    `infant_group_id` BIGINT UNSIGNED NULL,
    `can_withdraw` BOOLEAN NOT NULL DEFAULT true,
    `can_use_vtu` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` TIMESTAMP(0) NULL,
    `can_earn` BOOLEAN NOT NULL DEFAULT true,
    `can_opt_out` BOOLEAN NOT NULL DEFAULT true,
    `can_withdraw_gkwth` BOOLEAN NOT NULL DEFAULT true,
    `last_seen` TIMESTAMP(0) NULL,
    `activated_at` TIMESTAMP(0) NULL,
    `is_online` BOOLEAN NOT NULL DEFAULT false,
    `sponsorship_accepted_at` TIMESTAMP(0) NULL,
    `sponsor_agreement` BOOLEAN NULL,
    `sponsorship_status` ENUM('pending', 'approved', 'denied') NULL,
    `sponsor_login_otp` INTEGER NULL,
    `sponsor_login_otp_created_at` TIMESTAMP(0) NULL,
    `is_sponsor_account` VARCHAR(255) NULL,
    `influencer_id` BIGINT UNSIGNED NULL,
    `account_activation_acknowledged_at` TIMESTAMP(0) NULL,
    `sponsor_withdrawal_otp` INTEGER NULL,
    `sponsor_withdrawal_otp_sent_at` TIMESTAMP(0) NULL,
    `is_deactivated` BOOLEAN NOT NULL DEFAULT false,
    `sponsor_id` BIGINT UNSIGNED NULL,
    `sponsor_slot` INTEGER NOT NULL DEFAULT 0,
    `login_yearly_count` JSON NULL,
    `school_fees_permitted_at` TIMESTAMP(0) NULL,
    `withdrawal_bypass_at` TIMESTAMP(0) NULL,
    `is_unit_leader` BOOLEAN NOT NULL DEFAULT false,
    `school_id` BIGINT UNSIGNED NULL,
    `address` TEXT NULL,
    `sponsor_class` ENUM('unlimited', 'limited', 'personal') NULL,
    `transfer_id` VARCHAR(255) NULL,
    `unblocking_code` VARCHAR(255) NULL,
    `blocked_at` TIMESTAMP(0) NULL,
    `influencer_promo_period_id` BIGINT UNSIGNED NULL,
    `guardian_id` BIGINT UNSIGNED NULL,
    `guardian_ward_slot_id` BIGINT UNSIGNED NULL,
    `pim_id` VARCHAR(255) NULL,
    `patron_group_id` BIGINT UNSIGNED NULL,
    `activation_card_id` BIGINT UNSIGNED NULL,
    `upgrade_to_adult_at` TIMESTAMP(0) NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `has_verified_level_2` BOOLEAN NOT NULL DEFAULT false,
    `bvn` VARCHAR(255) NULL,
    `migrated_at` TIMESTAMP(0) NULL,
    `bvn_hash` VARCHAR(255) NULL,
    `pending_patron_type` VARCHAR(191) NULL,
    `refresh_token` VARCHAR(255) NULL,

    UNIQUE INDEX `users_transfer_id_unique`(`transfer_id`),
    UNIQUE INDEX `users_pim_id_unique`(`pim_id`),
    UNIQUE INDEX `users_bvn_hash_unique`(`bvn_hash`),
    INDEX `users_role_index`(`role`),
    INDEX `users_role_patron_id_index`(`role`, `patron_id`),
    INDEX `users_activation_card_id_foreign`(`activation_card_id`),
    INDEX `users_guardian_id_foreign`(`guardian_id`),
    INDEX `users_guardian_ward_slot_id_foreign`(`guardian_ward_slot_id`),
    INDEX `users_infant_group_id_foreign`(`infant_group_id`),
    INDEX `users_influencer_id_foreign`(`influencer_id`),
    INDEX `users_influencer_promo_period_id_foreign`(`influencer_promo_period_id`),
    INDEX `users_patron_group_id_foreign`(`patron_group_id`),
    INDEX `users_patron_id_foreign`(`patron_id`),
    INDEX `users_referral_id_foreign`(`referral_id`),
    INDEX `users_region_id_foreign`(`region_id`),
    INDEX `users_school_id_foreign`(`school_id`),
    INDEX `users_sponsor_id_foreign`(`sponsor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `regions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `max` INTEGER NOT NULL DEFAULT 3000000,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `states` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `l_g_a_s` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `state_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `l_g_a_s_state_id_foreign`(`state_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type` ENUM('direct', 'indirect', 'central_treasury', 'patronage', 'earning') NULL,
    `amount` DOUBLE NOT NULL DEFAULT 0.00,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `wallets_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `admin_id` BIGINT UNSIGNED NOT NULL,
    `action` ENUM('created', 'updated', 'deleted') NOT NULL,
    `model_id` INTEGER NOT NULL,
    `model_type` VARCHAR(255) NOT NULL,
    `old_values` JSON NOT NULL,
    `new_values` JSON NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `admin_logs_admin_id_foreign`(`admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `central_treasury_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `transaction_type` ENUM('sale', 'purchase', 'update', 'topup', 'weekly topup', 'loan') NULL,
    `wallet_id` BIGINT UNSIGNED NOT NULL,
    `performed_by` BIGINT UNSIGNED NOT NULL,
    `amount` DOUBLE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `central_treasury_logs_performed_by_foreign`(`performed_by`),
    INDEX `central_treasury_logs_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_transfers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender_wallet_id` BIGINT UNSIGNED NOT NULL,
    `receiver_wallet_id` BIGINT UNSIGNED NOT NULL,
    `amount` BIGINT UNSIGNED NOT NULL,
    `reference` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `wallet_transfers_reference_unique`(`reference`),
    INDEX `wallet_transfers_receiver_wallet_id_foreign`(`receiver_wallet_id`),
    INDEX `wallet_transfers_sender_wallet_id_foreign`(`sender_wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manually_fundings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `wallet_id` BIGINT UNSIGNED NOT NULL,
    `amount` VARCHAR(255) NOT NULL,
    `gkwth_value_per_unit` VARCHAR(255) NULL,
    `gkwth_amount_to_send` VARCHAR(255) NULL,
    `receipt` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `manually_fundings_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ads` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `frame_link` VARCHAR(255) NOT NULL,
    `external_link` VARCHAR(255) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `adverts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `image_url` TEXT NOT NULL,
    `cloudinary_public_id` TEXT NOT NULL,
    `link` TEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempt_logins` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `no_of_trials` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `attempt_logins_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blogs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `image_url` VARCHAR(255) NOT NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `blogs_title_unique`(`title`),
    INDEX `blogs_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blog_comments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `blog_id` BIGINT UNSIGNED NOT NULL,
    `comment_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(255) NOT NULL,
    `comment` TEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `blog_comments_blog_id_foreign`(`blog_id`),
    INDEX `blog_comments_comment_id_foreign`(`comment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tweets` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `status` VARCHAR(255) NULL,
    `img` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `tweets_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retweets` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `retweet_msg` VARCHAR(255) NULL,
    `retweet_img` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `retweetable_type` VARCHAR(255) NOT NULL,
    `retweetable_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `retweets_retweetable_type_retweetable_id_index`(`retweetable_type`, `retweetable_id`),
    INDEX `retweets_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `comment` VARCHAR(255) NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `commentable_type` VARCHAR(255) NOT NULL,
    `commentable_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `comments_commentable_type_commentable_id_index`(`commentable_type`, `commentable_id`),
    INDEX `comments_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `likes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `likeable_type` VARCHAR(255) NOT NULL,
    `likeable_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `likes_likeable_type_likeable_id_index`(`likeable_type`, `likeable_id`),
    INDEX `likes_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follows` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `follower_id` BIGINT UNSIGNED NOT NULL,
    `following_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `follows_follower_id_foreign`(`follower_id`),
    INDEX `follows_following_id_foreign`(`following_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender_id` BIGINT UNSIGNED NOT NULL,
    `receiver_id` BIGINT UNSIGNED NULL,
    `msg_body` TEXT NULL,
    `msg_image` VARCHAR(255) NULL,
    `read_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `chat_group_id` BIGINT UNSIGNED NULL,
    `sender_deleted_at` TIMESTAMP(0) NULL,
    `receiver_deleted_at` TIMESTAMP(0) NULL,

    INDEX `messages_chat_group_id_foreign`(`chat_group_id`),
    INDEX `messages_receiver_id_foreign`(`receiver_id`),
    INDEX `messages_sender_id_foreign`(`sender_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_groups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `image_url` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `chat_groups_created_by_foreign`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_group_user` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `chat_group_id` BIGINT UNSIGNED NOT NULL,

    INDEX `chat_group_user_chat_group_id_foreign`(`chat_group_id`),
    INDEX `chat_group_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`user_id`, `chat_group_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `quantity` INTEGER NOT NULL,
    `price` VARCHAR(255) NOT NULL,
    `image` VARCHAR(255) NOT NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `products_category_id_foreign`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `quantity` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `carts_product_id_foreign`(`product_id`),
    INDEX `carts_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wishlists` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `wishlists_product_id_foreign`(`product_id`),
    INDEX `wishlists_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_groups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `ref_no` VARCHAR(255) NOT NULL,
    `delivered_at` TIMESTAMP(0) NULL,
    `state_id` BIGINT UNSIGNED NULL,
    `address` TEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `lga_id` BIGINT UNSIGNED NULL,

    UNIQUE INDEX `order_groups_ref_no_unique`(`ref_no`),
    INDEX `order_groups_lga_id_foreign`(`lga_id`),
    INDEX `order_groups_state_id_foreign`(`state_id`),
    INDEX `order_groups_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_group_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `quantity` INTEGER NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `order_items_order_group_id_foreign`(`order_group_id`),
    INDEX `order_items_product_id_foreign`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `wallet_id` BIGINT UNSIGNED NULL,
    `order_group_id` BIGINT UNSIGNED NOT NULL,
    `payment_method` BOOLEAN NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `order_transactions_order_group_id_foreign`(`order_group_id`),
    INDEX `order_transactions_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loans` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `wallet_id` BIGINT UNSIGNED NULL,
    `status` ENUM('pending', 'rejected', 'granted') NOT NULL DEFAULT 'pending',
    `cancellation_reason` VARCHAR(255) NULL,
    `quantity_requested` DOUBLE NOT NULL,
    `quantity_granted` DOUBLE NOT NULL DEFAULT 0.00,
    `accepted_at` TIMESTAMP(0) NULL,
    `rejected_at` TIMESTAMP(0) NULL,
    `resolved_by` BIGINT UNSIGNED NULL,
    `resolved_at` TIMESTAMP(0) NULL,
    `quantity_repaid` DOUBLE NOT NULL DEFAULT 0.00,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `gkwth_price` DOUBLE NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `receipt` VARCHAR(255) NULL,

    INDEX `loans_resolved_by_foreign`(`resolved_by`),
    INDEX `loans_user_id_foreign`(`user_id`),
    INDEX `loans_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_resets` (
    `email` VARCHAR(255) NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `password_resets_email_index`(`email`),
    PRIMARY KEY (`email`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_user` (
    `status` BOOLEAN NOT NULL DEFAULT false,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `notification_id` BIGINT UNSIGNED NOT NULL,

    INDEX `notification_user_notification_id_foreign`(`notification_id`),
    PRIMARY KEY (`user_id`, `notification_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `public_notices` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `text` LONGTEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `data_type` VARCHAR(255) NOT NULL,
    `value` VARCHAR(255) NOT NULL DEFAULT '0',
    `options` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `settings_key_unique`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deleted_users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_deleted` VARCHAR(255) NOT NULL,
    `reason_for_delete` VARCHAR(255) NOT NULL,
    `deleted_by` VARCHAR(255) NOT NULL,
    `wallet_balance` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_levels` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `school_levels_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_terms` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `school_terms_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_fees` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `school_level_id` BIGINT UNSIGNED NOT NULL,
    `school_term_id` BIGINT UNSIGNED NOT NULL,
    `amount` DOUBLE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `school_fees_school_level_id_foreign`(`school_level_id`),
    INDEX `school_fees_school_term_id_foreign`(`school_term_id`),
    INDEX `school_fees_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_school_fee_groups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ref_no` VARCHAR(255) NOT NULL,
    `bank` VARCHAR(255) NOT NULL,
    `status` BOOLEAN NOT NULL,
    `receipt` VARCHAR(255) NULL,
    `account_number` VARCHAR(255) NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `transaction_failed` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `infant_school_fee_groups_ref_no_unique`(`ref_no`),
    INDEX `infant_school_fee_groups_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_school_fees` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `birth_cert` VARCHAR(255) NULL,
    `school_name` VARCHAR(255) NULL,
    `school_address` VARCHAR(255) NULL,
    `school_phone_number` VARCHAR(255) NULL,
    `school_class` VARCHAR(255) NULL,
    `school_term` VARCHAR(255) NULL,
    `amount` DOUBLE NULL,
    `bank_name` VARCHAR(255) NULL,
    `account_number` VARCHAR(255) NULL,
    `payment_receipt` VARCHAR(255) NULL,
    `status` ENUM('0', '1', '2') NOT NULL DEFAULT '0',
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `school_level_id` BIGINT UNSIGNED NULL,
    `school_term_id` BIGINT UNSIGNED NULL,
    `infant_school_fee_group_id` BIGINT UNSIGNED NULL,

    INDEX `infant_school_fees_infant_school_fee_group_id_foreign`(`infant_school_fee_group_id`),
    INDEX `infant_school_fees_school_level_id_foreign`(`school_level_id`),
    INDEX `infant_school_fees_school_term_id_foreign`(`school_term_id`),
    INDEX `infant_school_fees_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_upkeep_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `bank` VARCHAR(255) NOT NULL,
    `account_number` VARCHAR(255) NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` ENUM('pending', 'granted', 'rejected', 'being_processed') NOT NULL DEFAULT 'pending',
    `reference` VARCHAR(255) NULL,
    `cancellation_reason` VARCHAR(255) NULL,
    `request` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `infant_upkeep_requests_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_yearly_topups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `level` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `infant_yearly_topups_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `infant_form_fees` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `receipt` VARCHAR(255) NOT NULL,
    `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
    `reason_for_denying` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `infant_form_fees_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `influencer_promo_periods` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ref_no` VARCHAR(255) NOT NULL,
    `target` INTEGER NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `influencer_yearly_topup` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `approved_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `influencer_yearly_topup_approved_by_foreign`(`approved_by`),
    INDEX `influencer_yearly_topup_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sponsor_investment_returns` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `level` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `sponsor_id` BIGINT UNSIGNED NULL,

    INDEX `sponsor_investment_returns_sponsor_id_foreign`(`sponsor_id`),
    INDEX `sponsor_investment_returns_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_compensation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `infant_id` BIGINT UNSIGNED NULL,
    `school_id` BIGINT UNSIGNED NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT false,
    `amount` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `school_compensation_infant_id_foreign`(`infant_id`),
    INDEX `school_compensation_school_id_foreign`(`school_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unblocking_payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `bank` VARCHAR(255) NOT NULL,
    `account_number` VARCHAR(255) NOT NULL,
    `account_name` VARCHAR(255) NOT NULL,
    `receipt` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT false,
    `rejection_reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `reference` VARCHAR(255) NULL,
    `amount` DOUBLE NULL,

    INDEX `unblocking_payments_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_activation_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `bank_name` VARCHAR(255) NULL,
    `account_name` VARCHAR(255) NULL,
    `bank_account` VARCHAR(255) NULL,
    `amount` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `prove` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NULL,
    `status` ENUM('approved', 'denied', 'pending') NOT NULL DEFAULT 'pending',
    `confirmed_at` TIMESTAMP(0) NULL,
    `reference` VARCHAR(255) NULL,
    `charge` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `user_activation_requests_reference_unique`(`reference`),
    INDEX `user_activation_requests_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_activation_confirmation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT UNSIGNED NOT NULL,
    `cancellation_reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `account_activation_confirmation_request_id_foreign`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activation_team_mate_user` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `user_activation_request_id` BIGINT UNSIGNED NOT NULL,

    INDEX `activation_team_mate_user_user_activation_request_id_foreign`(`user_activation_request_id`),
    INDEX `activation_team_mate_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`user_id`, `user_activation_request_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activation_cards` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(255) NULL,
    `amount` DOUBLE NOT NULL,
    `price_per_user` DOUBLE NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `proof_of_payment` VARCHAR(255) NULL,
    `proof_of_payment_deleted_at` TIMESTAMP(0) NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `rejection_reason` VARCHAR(255) NULL,
    `approved_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `activation_cards_code_unique`(`code`),
    INDEX `activation_cards_approved_by_foreign`(`approved_by`),
    INDEX `activation_cards_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activation_card_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `activation_card_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `amount` DOUBLE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `activation_card_transactions_activation_card_id_foreign`(`activation_card_id`),
    INDEX `activation_card_transactions_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardian_ward_slot_purchases` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type` ENUM('limited', 'unlimited') NOT NULL DEFAULT 'limited',
    `quantity_purchased` INTEGER NULL,
    `quantity_left` INTEGER NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `price` DOUBLE NOT NULL DEFAULT 0.00,
    `charges` DOUBLE NULL,
    `reference` VARCHAR(255) NULL,
    `receipt_url` VARCHAR(255) NULL,
    `cloudinary_public_id` VARCHAR(255) NULL,
    `unlimited_revoked_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `company_name` VARCHAR(255) NULL,
    `company_address` VARCHAR(255) NULL,

    UNIQUE INDEX `guardian_ward_slot_purchases_reference_unique`(`reference`),
    INDEX `guardian_ward_slot_purchases_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patron_plans` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `min_amount` DOUBLE NOT NULL,
    `max_amount` DOUBLE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `patron_plans_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patron_groups` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,
    `plan_id` BIGINT UNSIGNED NULL,
    `type` VARCHAR(50) NULL,

    UNIQUE INDEX `patron_groups_name_unique`(`name`),
    INDEX `patron_groups_user_id_foreign`(`user_id`),
    INDEX `patron_groups_plan_id_foreign`(`plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `patron_group_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `patron_group_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `type` ENUM('credit', 'debit') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `description` TEXT NULL,
    `reference` VARCHAR(255) NULL,
    `wallet_id` BIGINT UNSIGNED NULL,
    `charge` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',

    UNIQUE INDEX `patron_group_transactions_reference_key`(`reference`),
    INDEX `patron_group_transactions_patron_group_id_foreign`(`patron_group_id`),
    INDEX `patron_group_transactions_user_id_foreign`(`user_id`),
    INDEX `patron_group_transactions_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `with_drawals` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NULL,
    `amount` VARCHAR(255) NOT NULL,
    `bank_name` VARCHAR(255) NOT NULL,
    `account_number` VARCHAR(255) NOT NULL,
    `isPaid` INTEGER NOT NULL DEFAULT 2,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `old_balance` VARCHAR(255) NULL,
    `new_balance` VARCHAR(255) NULL,
    `gkwth_price` DOUBLE NULL,
    `paystack_ref` VARCHAR(255) NULL,
    `user_type` ENUM('customer', 'sponsor', 'influencer', 'admin') NOT NULL DEFAULT 'customer',
    `user_email` VARCHAR(255) NULL,
    `sponsor_investment_returns_id` BIGINT UNSIGNED NULL,
    `requested_at` TIMESTAMP(0) NULL,
    `reference` VARCHAR(255) NULL,
    `account_name` VARCHAR(255) NULL,
    `paga_ref` VARCHAR(255) NULL,
    `paga_transaction_id` VARCHAR(255) NULL,

    INDEX `with_drawals_sponsor_investment_returns_id_foreign`(`sponsor_investment_returns_id`),
    INDEX `with_drawals_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawal_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `amount_requested` DOUBLE NOT NULL,
    `amount_to_transfer` DOUBLE NOT NULL,
    `wallet_id` BIGINT UNSIGNED NULL,
    `old_balance` VARCHAR(255) NOT NULL,
    `new_balance` VARCHAR(255) NOT NULL,
    `user_type` ENUM('customer', 'sponsor', 'influencer', 'patron') NULL,
    `bank_name` VARCHAR(255) NOT NULL,
    `bank_code` VARCHAR(255) NULL,
    `account_number` VARCHAR(255) NOT NULL,
    `gkwth_amount` DOUBLE NULL,
    `gkwth_value` DOUBLE NULL,
    `user_email` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,
    `sponsor_investment_returns_id` BIGINT UNSIGNED NULL,
    `status` ENUM('pending', 'being_processed', 'processed', 'failed') NOT NULL DEFAULT 'pending',
    `reference` VARCHAR(255) NULL,
    `account_name` VARCHAR(255) NULL,

    INDEX `withdrawal_requests_sponsor_investment_returns_id_foreign`(`sponsor_investment_returns_id`),
    INDEX `withdrawal_requests_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `guard_name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `tag` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `permissions_name_guard_name_unique`(`name`, `guard_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `guard_name` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `roles_name_guard_name_unique`(`name`, `guard_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_has_permissions` (
    `permission_id` BIGINT UNSIGNED NOT NULL,
    `role_id` BIGINT UNSIGNED NOT NULL,

    INDEX `role_has_permissions_role_id_foreign`(`role_id`),
    PRIMARY KEY (`permission_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_has_permissions` (
    `permission_id` BIGINT UNSIGNED NOT NULL,
    `model_type` VARCHAR(255) NOT NULL,
    `model_id` BIGINT UNSIGNED NOT NULL,

    INDEX `model_has_permissions_model_id_model_type_index`(`model_id`, `model_type`),
    PRIMARY KEY (`permission_id`, `model_id`, `model_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_has_roles` (
    `role_id` BIGINT UNSIGNED NOT NULL,
    `model_type` VARCHAR(255) NOT NULL,
    `model_id` BIGINT UNSIGNED NOT NULL,

    INDEX `model_has_roles_model_id_model_type_index`(`model_id`, `model_type`),
    PRIMARY KEY (`role_id`, `model_id`, `model_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `personal_access_tokens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `tokenable_type` VARCHAR(255) NOT NULL,
    `tokenable_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `abilities` TEXT NULL,
    `last_used_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `personal_access_tokens_token_unique`(`token`),
    INDEX `personal_access_tokens_tokenable_type_tokenable_id_index`(`tokenable_type`, `tokenable_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quizzes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ref_no` VARCHAR(255) NOT NULL,
    `score_percentage` INTEGER NOT NULL,
    `vote_percentage` INTEGER NOT NULL,
    `registration_starts` TIMESTAMP(0) NOT NULL,
    `registration_ends` TIMESTAMP(0) NOT NULL,
    `total_phase` INTEGER NOT NULL,
    `phase_qualification_percentage` INTEGER NOT NULL,
    `min_class` BIGINT UNSIGNED NULL,
    `max_class` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `quizzes_ref_no_unique`(`ref_no`),
    INDEX `quizzes_max_class_foreign`(`max_class`),
    INDEX `quizzes_min_class_foreign`(`min_class`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_phases` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_id` BIGINT UNSIGNED NOT NULL,
    `phase` INTEGER NOT NULL,
    `time` INTEGER NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `quiz_phases_quiz_id_foreign`(`quiz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_questions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_phase_id` BIGINT UNSIGNED NOT NULL,
    `question` TEXT NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `quiz_questions_quiz_phase_id_foreign`(`quiz_phase_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_question_options` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_question_id` BIGINT UNSIGNED NOT NULL,
    `option` VARCHAR(255) NOT NULL,
    `is_answer` BOOLEAN NOT NULL DEFAULT false,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `quiz_question_options_quiz_question_id_foreign`(`quiz_question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_user` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `quiz_user_quiz_id_foreign`(`quiz_id`),
    INDEX `quiz_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_phase_user` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_phase_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `start_at` TIMESTAMP(0) NULL,
    `ends_at` TIMESTAMP(0) NULL,
    `score` INTEGER NULL,
    `is_qualified_for_next_phase` BOOLEAN NOT NULL DEFAULT true,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `quiz_phase_user_quiz_phase_id_foreign`(`quiz_phase_id`),
    INDEX `quiz_phase_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prizes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `url` VARCHAR(255) NULL,
    `type` ENUM('awards', 'bonus') NOT NULL DEFAULT 'awards',
    `region_id` BIGINT UNSIGNED NULL,
    `position` INTEGER NOT NULL,
    `total_persons` JSON NOT NULL,
    `location` LONGTEXT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `prizes_region_id_foreign`(`region_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prize_user` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `prize_id` BIGINT UNSIGNED NOT NULL,

    INDEX `prize_user_prize_id_foreign`(`prize_id`),
    INDEX `prize_user_user_id_foreign`(`user_id`),
    PRIMARY KEY (`user_id`, `prize_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reels` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(255) NOT NULL,
    `cloudinary_public_id` VARCHAR(255) NOT NULL,
    `file_type` ENUM('image', 'video') NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migrations` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `migration` VARCHAR(255) NOT NULL,
    `batch` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audits` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_type` VARCHAR(255) NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `event` VARCHAR(255) NOT NULL,
    `auditable_type` VARCHAR(255) NOT NULL,
    `auditable_id` BIGINT UNSIGNED NOT NULL,
    `old_values` TEXT NULL,
    `new_values` TEXT NULL,
    `url` TEXT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(1023) NULL,
    `tags` VARCHAR(255) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `audits_auditable_type_auditable_id_index`(`auditable_type`, `auditable_id`),
    INDEX `audits_user_id_user_type_index`(`user_id`, `user_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_handoff_tokens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `token` VARCHAR(255) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` TIMESTAMP(0) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `failed_jobs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(255) NOT NULL,
    `connection` TEXT NOT NULL,
    `queue` TEXT NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `exception` LONGTEXT NOT NULL,
    `failed_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `failed_jobs_uuid_unique`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earning_settings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `value` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `earning_settings_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earning_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(10, 2) NOT NULL,
    `type` ENUM('credit', 'debit') NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `wallet_id` BIGINT UNSIGNED NOT NULL,
    `narration` VARCHAR(255) NOT NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    UNIQUE INDEX `earning_transactions_reference_unique`(`reference`),
    INDEX `earning_transactions_wallet_id_foreign`(`wallet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_level2_migrations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,

    INDEX `pending_level2_migrations_user_id_foreign`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_activation_card_id_foreign` FOREIGN KEY (`activation_card_id`) REFERENCES `activation_cards`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_guardian_id_foreign` FOREIGN KEY (`guardian_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_guardian_ward_slot_id_foreign` FOREIGN KEY (`guardian_ward_slot_id`) REFERENCES `guardian_ward_slot_purchases`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_infant_group_id_foreign` FOREIGN KEY (`infant_group_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_influencer_id_foreign` FOREIGN KEY (`influencer_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_influencer_promo_period_id_foreign` FOREIGN KEY (`influencer_promo_period_id`) REFERENCES `influencer_promo_periods`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_patron_group_id_foreign` FOREIGN KEY (`patron_group_id`) REFERENCES `patron_groups`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_patron_id_foreign` FOREIGN KEY (`patron_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_referral_id_foreign` FOREIGN KEY (`referral_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_region_id_foreign` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_sponsor_id_foreign` FOREIGN KEY (`sponsor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `l_g_a_s` ADD CONSTRAINT `l_g_a_s_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `admin_logs` ADD CONSTRAINT `admin_logs_admin_id_foreign` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `central_treasury_logs` ADD CONSTRAINT `central_treasury_logs_performed_by_foreign` FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `central_treasury_logs` ADD CONSTRAINT `central_treasury_logs_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `wallet_transfers` ADD CONSTRAINT `wallet_transfers_receiver_wallet_id_foreign` FOREIGN KEY (`receiver_wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `wallet_transfers` ADD CONSTRAINT `wallet_transfers_sender_wallet_id_foreign` FOREIGN KEY (`sender_wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `manually_fundings` ADD CONSTRAINT `manually_fundings_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `attempt_logins` ADD CONSTRAINT `attempt_logins_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `blogs` ADD CONSTRAINT `blogs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `blog_comments` ADD CONSTRAINT `blog_comments_blog_id_foreign` FOREIGN KEY (`blog_id`) REFERENCES `blogs`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `blog_comments` ADD CONSTRAINT `blog_comments_comment_id_foreign` FOREIGN KEY (`comment_id`) REFERENCES `blog_comments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `tweets` ADD CONSTRAINT `tweets_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `retweets` ADD CONSTRAINT `retweets_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `likes` ADD CONSTRAINT `likes_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_follower_id_foreign` FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_following_id_foreign` FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_chat_group_id_foreign` FOREIGN KEY (`chat_group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_receiver_id_foreign` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_id_foreign` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `chat_groups` ADD CONSTRAINT `chat_groups_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `chat_group_user` ADD CONSTRAINT `chat_group_user_chat_group_id_foreign` FOREIGN KEY (`chat_group_id`) REFERENCES `chat_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `chat_group_user` ADD CONSTRAINT `chat_group_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_foreign` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `carts` ADD CONSTRAINT `carts_product_id_foreign` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `carts` ADD CONSTRAINT `carts_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `wishlists` ADD CONSTRAINT `wishlists_product_id_foreign` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `wishlists` ADD CONSTRAINT `wishlists_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_groups` ADD CONSTRAINT `order_groups_lga_id_foreign` FOREIGN KEY (`lga_id`) REFERENCES `l_g_a_s`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_groups` ADD CONSTRAINT `order_groups_state_id_foreign` FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_groups` ADD CONSTRAINT `order_groups_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_group_id_foreign` FOREIGN KEY (`order_group_id`) REFERENCES `order_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_foreign` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_transactions` ADD CONSTRAINT `order_transactions_order_group_id_foreign` FOREIGN KEY (`order_group_id`) REFERENCES `order_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `order_transactions` ADD CONSTRAINT `order_transactions_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_resolved_by_foreign` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `notification_user` ADD CONSTRAINT `notification_user_notification_id_foreign` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `notification_user` ADD CONSTRAINT `notification_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `school_fees` ADD CONSTRAINT `school_fees_school_level_id_foreign` FOREIGN KEY (`school_level_id`) REFERENCES `school_levels`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `school_fees` ADD CONSTRAINT `school_fees_school_term_id_foreign` FOREIGN KEY (`school_term_id`) REFERENCES `school_terms`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `school_fees` ADD CONSTRAINT `school_fees_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_school_fee_groups` ADD CONSTRAINT `infant_school_fee_groups_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_school_fees` ADD CONSTRAINT `infant_school_fees_infant_school_fee_group_id_foreign` FOREIGN KEY (`infant_school_fee_group_id`) REFERENCES `infant_school_fee_groups`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_school_fees` ADD CONSTRAINT `infant_school_fees_school_level_id_foreign` FOREIGN KEY (`school_level_id`) REFERENCES `school_levels`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_school_fees` ADD CONSTRAINT `infant_school_fees_school_term_id_foreign` FOREIGN KEY (`school_term_id`) REFERENCES `school_terms`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_school_fees` ADD CONSTRAINT `infant_school_fees_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_upkeep_requests` ADD CONSTRAINT `infant_upkeep_requests_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_yearly_topups` ADD CONSTRAINT `infant_yearly_topups_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `infant_form_fees` ADD CONSTRAINT `infant_form_fees_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `influencer_yearly_topup` ADD CONSTRAINT `influencer_yearly_topup_approved_by_foreign` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `influencer_yearly_topup` ADD CONSTRAINT `influencer_yearly_topup_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `sponsor_investment_returns` ADD CONSTRAINT `sponsor_investment_returns_sponsor_id_foreign` FOREIGN KEY (`sponsor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `sponsor_investment_returns` ADD CONSTRAINT `sponsor_investment_returns_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `school_compensation` ADD CONSTRAINT `school_compensation_infant_id_foreign` FOREIGN KEY (`infant_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `school_compensation` ADD CONSTRAINT `school_compensation_school_id_foreign` FOREIGN KEY (`school_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `unblocking_payments` ADD CONSTRAINT `unblocking_payments_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_activation_requests` ADD CONSTRAINT `user_activation_requests_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `account_activation_confirmation` ADD CONSTRAINT `account_activation_confirmation_request_id_foreign` FOREIGN KEY (`request_id`) REFERENCES `user_activation_requests`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_team_mate_user` ADD CONSTRAINT `activation_team_mate_user_user_activation_request_id_foreign` FOREIGN KEY (`user_activation_request_id`) REFERENCES `user_activation_requests`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_team_mate_user` ADD CONSTRAINT `activation_team_mate_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_cards` ADD CONSTRAINT `activation_cards_approved_by_foreign` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_cards` ADD CONSTRAINT `activation_cards_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_card_transactions` ADD CONSTRAINT `activation_card_transactions_activation_card_id_foreign` FOREIGN KEY (`activation_card_id`) REFERENCES `activation_cards`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `activation_card_transactions` ADD CONSTRAINT `activation_card_transactions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `guardian_ward_slot_purchases` ADD CONSTRAINT `guardian_ward_slot_purchases_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `patron_groups` ADD CONSTRAINT `patron_groups_plan_id_foreign` FOREIGN KEY (`plan_id`) REFERENCES `patron_plans`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `patron_groups` ADD CONSTRAINT `patron_groups_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `patron_group_transactions` ADD CONSTRAINT `patron_group_transactions_patron_group_id_foreign` FOREIGN KEY (`patron_group_id`) REFERENCES `patron_groups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `patron_group_transactions` ADD CONSTRAINT `patron_group_transactions_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `patron_group_transactions` ADD CONSTRAINT `patron_group_transactions_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `with_drawals` ADD CONSTRAINT `with_drawals_sponsor_investment_returns_id_foreign` FOREIGN KEY (`sponsor_investment_returns_id`) REFERENCES `sponsor_investment_returns`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `with_drawals` ADD CONSTRAINT `with_drawals_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `withdrawal_requests` ADD CONSTRAINT `withdrawal_requests_sponsor_investment_returns_id_foreign` FOREIGN KEY (`sponsor_investment_returns_id`) REFERENCES `sponsor_investment_returns`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `withdrawal_requests` ADD CONSTRAINT `withdrawal_requests_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `role_has_permissions` ADD CONSTRAINT `role_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `role_has_permissions` ADD CONSTRAINT `role_has_permissions_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `model_has_permissions` ADD CONSTRAINT `model_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `model_has_roles` ADD CONSTRAINT `model_has_roles_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_max_class_foreign` FOREIGN KEY (`max_class`) REFERENCES `school_levels`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quizzes` ADD CONSTRAINT `quizzes_min_class_foreign` FOREIGN KEY (`min_class`) REFERENCES `school_levels`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_phases` ADD CONSTRAINT `quiz_phases_quiz_id_foreign` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_questions` ADD CONSTRAINT `quiz_questions_quiz_phase_id_foreign` FOREIGN KEY (`quiz_phase_id`) REFERENCES `quiz_phases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_question_options` ADD CONSTRAINT `quiz_question_options_quiz_question_id_foreign` FOREIGN KEY (`quiz_question_id`) REFERENCES `quiz_questions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_user` ADD CONSTRAINT `quiz_user_quiz_id_foreign` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_user` ADD CONSTRAINT `quiz_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_phase_user` ADD CONSTRAINT `quiz_phase_user_quiz_phase_id_foreign` FOREIGN KEY (`quiz_phase_id`) REFERENCES `quiz_phases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `quiz_phase_user` ADD CONSTRAINT `quiz_phase_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `prizes` ADD CONSTRAINT `prizes_region_id_foreign` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `prize_user` ADD CONSTRAINT `prize_user_prize_id_foreign` FOREIGN KEY (`prize_id`) REFERENCES `prizes`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `prize_user` ADD CONSTRAINT `prize_user_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `earning_transactions` ADD CONSTRAINT `earning_transactions_wallet_id_foreign` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `pending_level2_migrations` ADD CONSTRAINT `pending_level2_migrations_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

