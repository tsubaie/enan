-- ADR 0064: passkeys, through Better Auth's passkey plugin. A new table only: the previous release
-- never reads it.
CREATE TABLE `auth_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_passkeys_user_idx` ON `auth_passkeys` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_passkeys_credential_idx` ON `auth_passkeys` (`credential_id`);