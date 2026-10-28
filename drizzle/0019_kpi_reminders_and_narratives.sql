-- KPIS-B30, KPIS-B32: KPI reading reminders and executive briefs. The new table and column are
-- additive; the previous release never reads them.
CREATE TABLE `kpi_narratives` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text,
	`kpi_id` text,
	`locale` text NOT NULL,
	`period_mode` text DEFAULT 'current' NOT NULL,
	`data_hash` text NOT NULL,
	`job_id` text,
	`status` text DEFAULT 'generating' NOT NULL,
	`headline` text,
	`body_markdown` text,
	`highlights_json` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kpi_id`) REFERENCES `kpis`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kpi_narratives_locale_check" CHECK("kpi_narratives"."locale" in ('en', 'ar')),
	CONSTRAINT "kpi_narratives_period_check" CHECK("kpi_narratives"."period_mode" in ('previous', 'current', 'next')),
	CONSTRAINT "kpi_narratives_status_check" CHECK("kpi_narratives"."status" in ('generating', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `kpi_narratives_kpi_idx` ON `kpi_narratives` (`kpi_id`,`locale`,`created_at`);--> statement-breakpoint
CREATE INDEX `kpi_narratives_objective_idx` ON `kpi_narratives` (`objective_id`);--> statement-breakpoint
CREATE INDEX `kpi_narratives_job_idx` ON `kpi_narratives` (`job_id`);--> statement-breakpoint
CREATE INDEX `kpi_narratives_creator_idx` ON `kpi_narratives` (`created_by`);--> statement-breakpoint
-- enan:compatible rebuilds notifications only to widen notifications_kind_check for kpi.reading_due (KPIS-B30); every column, index and foreign key is kept, the previous release writes no such row and skips a kind it does not know.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notifications_kind_check" CHECK("__new_notifications"."kind" in ('task.assigned','task.due_today','task.overdue','note.mentioned','kpi.off_target','kpi.reading_due','job.finished','update.available','update.installed','update.failed','update.rollback_failed','update.blocked','update.stalled','update.updater_outdated'))
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "kind", "subject_type", "subject_id", "payload", "actor_id", "created_at", "read_at") SELECT "id", "user_id", "kind", "subject_type", "subject_id", "payload", "actor_id", "created_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_feed_idx` ON `notifications` (`user_id`,`read_at`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `notifications_actor_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_unread_subject_idx` ON `notifications` (`user_id`,`kind`,`subject_id`) WHERE "notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE `kpis` ADD `reminders_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- KPIS-B30: the reading-due reminders run once a day at 05:00 UTC, after the task reminders. The id
-- is fixed so a restored backup and a fresh install agree.
INSERT INTO `schedules` (`id`, `kind`, `cron`, `timezone`, `payload`) VALUES
  ('01a182a5-54ff-7807-bab4-6e0a07d052af', 'kpis.reminders', '0 5 * * *', 'UTC', '{}')
ON CONFLICT (`id`) DO NOTHING;
