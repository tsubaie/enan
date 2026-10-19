PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `files` SET `availability` = 'missing', `purged_at` = NULL WHERE `availability` = 'purged';--> statement-breakpoint
ALTER TABLE `files` RENAME COLUMN `purged_at` TO `archived_at`;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`page_count` integer,
	`availability` text DEFAULT 'available' NOT NULL,
	`archived_at` integer,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "files_availability_check" CHECK("__new_files"."availability" in ('available','archived','missing'))
);
--> statement-breakpoint
INSERT INTO `__new_files`("id", "storage_key", "original_name", "mime", "size_bytes", "sha256", "page_count", "availability", "archived_at", "uploaded_by", "created_at") SELECT "id", "storage_key", "original_name", "mime", "size_bytes", "sha256", "page_count", "availability", "archived_at", "uploaded_by", "created_at" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_unique` ON `files` (`storage_key`);