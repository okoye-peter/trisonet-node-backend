-- AlterTable: allow shop checkout without an account (guest checkout).
-- user_id becomes nullable; guest_* columns capture the buyer's contact details
-- when there is no user row. The existing FK/CASCADE on user_id is unaffected —
-- a nullable FK column simply skips the constraint check when NULL.
ALTER TABLE `pending_shop_orders`
    MODIFY `user_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `guest_name` VARCHAR(255) NULL,
    ADD COLUMN `guest_email` VARCHAR(255) NULL,
    ADD COLUMN `guest_phone` VARCHAR(255) NULL;
