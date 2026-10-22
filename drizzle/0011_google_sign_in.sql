-- ADMIN-B65 (ADR 0053): the Google OAuth client (secret sealed) and the Google account each user is tied to.
CREATE TABLE `google_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "google_settings_singleton" CHECK("google_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `google_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_idx` ON `users` (`google_subject`);