-- ADMIN-B60 (ADR 0053): the outgoing mail server saved from Administration, its password sealed.
CREATE TABLE `mail_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`encrypted_password` text,
	`from_address` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "mail_settings_singleton" CHECK("mail_settings"."id" = 1)
);
