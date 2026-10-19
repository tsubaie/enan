CREATE TABLE `wallpapers` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`name` text NOT NULL,
	`tone` text NOT NULL,
	`accent` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "wallpapers_tone_check" CHECK("wallpapers"."tone" in ('light','dark'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallpapers_file_unique` ON `wallpapers` (`file_id`);--> statement-breakpoint
CREATE INDEX `wallpapers_created_by_idx` ON `wallpapers` (`created_by`);--> statement-breakpoint
CREATE INDEX `wallpapers_created_at_idx` ON `wallpapers` (`created_at`);