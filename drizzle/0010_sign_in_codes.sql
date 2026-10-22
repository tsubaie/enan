-- ADMIN-B63 (ADR 0053): requests for an emailed sign-in code; the code itself is kept only as an HMAC.
CREATE TABLE `sign_in_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`code_hash` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`ip` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sign_in_codes_email_time_idx` ON `sign_in_codes` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `sign_in_codes_ip_time_idx` ON `sign_in_codes` (`ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `sign_in_codes_user_idx` ON `sign_in_codes` (`user_id`);