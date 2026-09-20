-- A1: rename agents -> principals, add auth/admin columns, api_keys v2, settings, audit log changes.
-- Uses ALTER TABLE RENAME TO; verified with PRAGMA foreign_key_check in tests.

-- Preserve legacy API key rows for the post-migration importer.
CREATE TABLE `_legacy_api_keys` AS
SELECT id, agent_id, key_hash, name, role, last_used_at, created_at FROM `api_keys`;
--> statement-breakpoint

-- Rename agents to principals. SQLite updates FK references in referencing tables.
ALTER TABLE `agents` RENAME TO `principals`;
--> statement-breakpoint

-- Add human/auth/admin columns to principals.
ALTER TABLE `principals` ADD COLUMN `email` text;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `password_hash` text;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `last_login_at` integer;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `failed_login_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `locked_until` integer;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `password_changed_at` integer;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `must_change_password` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `principals` ADD COLUMN `updated_at` integer;
--> statement-breakpoint

-- Unique constraint as an index because ALTER TABLE ADD COLUMN rejects UNIQUE.
CREATE UNIQUE INDEX `principals_email_unique` ON `principals` (`email`);
--> statement-breakpoint

-- The legacy v1 owner row used kind='manual'. v2 uses kind='human'.
UPDATE `principals` SET `kind` = 'human' WHERE `kind` = 'manual';
--> statement-breakpoint

-- New api_keys table (v2): prefix-addressable, SHA-256 at rest, no per-key role.
DROP TABLE `api_keys`;
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL UNIQUE,
	`key_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_prefix_unique` ON `api_keys` (`prefix`);
--> statement-breakpoint

-- Activities becomes the full audit log: nullable task_id and audit target columns.
ALTER TABLE `activities` RENAME TO `_old_activities`;
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`from_value` text,
	`to_value` text,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `activities` (
	`id`, `task_id`, `actor_id`, `action`, `target_type`, `target_id`,
	`from_value`, `to_value`, `payload`, `created_at`
)
SELECT
	`id`, `task_id`, `actor_id`, `action`, NULL, NULL,
	`from_value`, `to_value`, `payload`, `created_at`
FROM `_old_activities`;
--> statement-breakpoint
DROP TABLE `_old_activities`;
--> statement-breakpoint

-- New settings table for DB-backed configuration and encrypted secrets.
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`value_encrypted` blob,
	`is_secret` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

-- Record migration time so the runtime can expire the legacy OWNER_TOKEN claim path.
INSERT INTO `settings` (`key`, `value`, `updated_at`) VALUES (
	'auth.legacyClaimExpiresAt',
	(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 604800000),
	(CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
