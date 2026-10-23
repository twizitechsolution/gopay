-- ============================================================
-- Gopay Platform - Production MySQL Schema & Seed Data
-- Designed for aaPanel / Linux Nginx / MySQL 5.7 & 8.0+
-- Database: gopay_db
-- ============================================================

CREATE DATABASE IF NOT EXISTS `gopay_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `gopay_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- Table: users
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(64) NOT NULL UNIQUE,
  `mobile` VARCHAR(20) NOT NULL UNIQUE,
  `username` VARCHAR(120) DEFAULT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `pin` VARCHAR(10) DEFAULT '1234',
  `ref_code` VARCHAR(64) NOT NULL UNIQUE,
  `parent_id` INT DEFAULT NULL,
  `inr_balance` DECIMAL(15,2) DEFAULT 0.00,
  `bcoin_balance` DECIMAL(15,2) DEFAULT 0.00,
  `usdt_balance` DECIMAL(15,2) DEFAULT 0.00,
  `total_earnings` DECIMAL(15,2) DEFAULT 0.00,
  `today_profit` DECIMAL(15,2) DEFAULT 0.00,
  `yesterday_profit` DECIMAL(15,2) DEFAULT 0.00,
  `is_blocked` TINYINT(1) DEFAULT 0,
  `fcm_tokens` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_users_mobile` (`mobile`),
  INDEX `idx_users_ref_code` (`ref_code`),
  INDEX `idx_users_parent_id` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: orders
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` VARCHAR(64) NOT NULL UNIQUE,
  `user_id` INT NOT NULL,
  `asset_type` VARCHAR(32) DEFAULT 'INR',
  `amount` DECIMAL(15,2) NOT NULL,
  `expected_income` DECIMAL(15,2) DEFAULT 0.00,
  `quota` INT DEFAULT 1,
  `status` VARCHAR(32) DEFAULT 'Pending',
  `utr` VARCHAR(128) DEFAULT NULL,
  `receiver_id` INT DEFAULT NULL,
  `withdrawal_id` INT DEFAULT NULL,
  `timer_expiry` BIGINT DEFAULT NULL,
  `receiver_details` TEXT DEFAULT NULL,
  `screenshot_path` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_orders_user_id` (`user_id`),
  INDEX `idx_orders_status` (`status`),
  INDEX `idx_orders_receiver_id` (`receiver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: bank_accounts
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `bank_accounts`;
CREATE TABLE `bank_accounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `bank_name` VARCHAR(128) NOT NULL,
  `account_holder` VARCHAR(128) NOT NULL,
  `account_number` VARCHAR(64) NOT NULL,
  `ifsc_code` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) DEFAULT 'Active',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_banks_user_id` (`user_id`),
  INDEX `idx_banks_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: transactions
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `transactions`;
CREATE TABLE `transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `balance_after` DECIMAL(15,2) DEFAULT 0.00,
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_tx_user_id` (`user_id`),
  INDEX `idx_tx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: withdrawals
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `withdrawals`;
CREATE TABLE `withdrawals` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `amount_pending` DECIMAL(15,2) DEFAULT 0.00,
  `status` VARCHAR(32) DEFAULT 'Pending',
  `bank_account_id` INT DEFAULT NULL,
  `utr` VARCHAR(128) DEFAULT NULL,
  `txid` VARCHAR(128) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_wd_user_id` (`user_id`),
  INDEX `idx_wd_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: products
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(128) NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `income` DECIMAL(15,2) NOT NULL,
  `quota` INT DEFAULT 1,
  `color` VARCHAR(32) DEFAULT '#4F46E5',
  `type` VARCHAR(32) DEFAULT 'Bank',
  `percent` DECIMAL(8,2) DEFAULT 0.00,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: disputes
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `disputes`;
CREATE TABLE `disputes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` VARCHAR(64) DEFAULT NULL,
  `raiser_id` INT NOT NULL,
  `reason` TEXT DEFAULT NULL,
  `proof_path` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(32) DEFAULT 'Pending',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_disp_raiser` (`raiser_id`),
  INDEX `idx_disp_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: settings
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `key` VARCHAR(128) PRIMARY KEY,
  `value` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: user_tasks
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `user_tasks`;
CREATE TABLE `user_tasks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `task_key` VARCHAR(64) NOT NULL,
  `completed` TINYINT(1) DEFAULT 0,
  `claimed` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_task_user` (`user_id`, `task_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: messages
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: sliders
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `sliders`;
CREATE TABLE `sliders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `image_url` VARCHAR(255) NOT NULL,
  `title` VARCHAR(128) DEFAULT NULL,
  `link` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table: price_ranges
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `price_ranges`;
CREATE TABLE `price_ranges` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `label` VARCHAR(64) NOT NULL,
  `min_val` DECIMAL(15,2) NOT NULL,
  `max_val` DECIMAL(15,2) NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SEED DATA
-- ============================================================

-- 1. Default Super Admin User
INSERT INTO `users` (`id`, `uid`, `mobile`, `username`, `password_hash`, `pin`, `ref_code`, `parent_id`, `inr_balance`, `bcoin_balance`, `usdt_balance`, `total_earnings`, `today_profit`, `yesterday_profit`, `is_blocked`)
VALUES (1, 'M100001', '9999999999', 'Super Admin', '$2a$10$w8TfG9r0tL87gA9bZqC7euO5d0kQG1ZJkP3F5zM2Yw5u0m2a9B', '1234', 'admin001', NULL, 100000.00, 10000.00, 1000.00, 0.00, 0.00, 0.00, 0)
ON DUPLICATE KEY UPDATE `username`='Super Admin';

-- 2. Default System Settings
INSERT INTO `settings` (`key`, `value`) VALUES
('config', '{"level1_commission":10,"level2_commission":5,"level3_commission":2,"telegram_link":"https://t.me/Gopay","payment_mode":"gateway","min_order_amount":500,"max_order_amount":100000,"default_ref_code":"admin001"}'),
('admin', '{"username":"gopayadmin","password":"gopay@143#!"}')
ON DUPLICATE KEY UPDATE `value`=VALUES(`value`);

-- 3. Default Price Ranges
INSERT INTO `price_ranges` (`id`, `label`, `min_val`, `max_val`) VALUES
(1, '500 - 5000', 500.00, 5000.00),
(2, '5000 - 20000', 5000.00, 20000.00),
(3, '20000 - 50000', 20000.00, 50000.00),
(4, '50000 - 100000', 50000.00, 100000.00),
(5, '100000+', 100000.00, 1000000.00)
ON DUPLICATE KEY UPDATE `label`=VALUES(`label`);

-- 4. Initial Product Plans
INSERT INTO `products` (`id`, `name`, `amount`, `income`, `quota`, `color`, `type`, `percent`) VALUES
(1, 'Gopay Starter', 500.00, 25.00, 1, '#4F46E5', 'Bank', 5.00),
(2, 'Gopay Silver', 1000.00, 60.00, 1, '#06B6D4', 'Bank', 6.00),
(3, 'Gopay Gold', 3000.00, 210.00, 1, '#F59E0B', 'Bank', 7.00),
(4, 'Gopay Platinum', 5000.00, 400.00, 1, '#10B981', 'Bank', 8.00),
(5, 'Gopay Diamond', 10000.00, 900.00, 1, '#8B5CF6', 'Bank', 9.00),
(6, 'Gopay Crown', 25000.00, 2500.00, 1, '#EC4899', 'Bank', 10.00)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

SET FOREIGN_KEY_CHECKS = 1;
