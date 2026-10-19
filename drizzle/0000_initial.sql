CREATE TABLE `ai_credentials` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "ai_credentials_singleton" CHECK("ai_credentials"."id" = 1),
	CONSTRAINT "ai_credentials_provider" CHECK("ai_credentials"."provider" in ('anthropic', 'openrouter'))
);
--> statement-breakpoint
CREATE TABLE `ai_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`capability` text NOT NULL,
	`capability_version` integer NOT NULL,
	`requested_model` text NOT NULL,
	`effective_model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`status` text NOT NULL,
	`error` text,
	`estimated_cost_micros` integer,
	`pricing_version` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_status_check" CHECK("ai_invocations"."status" in ('ok','error','refused','invalid_output'))
);
--> statement-breakpoint
CREATE INDEX `ai_invocations_job_idx` ON `ai_invocations` (`job_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`op_id` text,
	`diff` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_time_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`page_count` integer,
	`availability` text DEFAULT 'available' NOT NULL,
	`purged_at` integer,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "files_availability_check" CHECK("files"."availability" in ('available','purged','missing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_unique` ON `files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`lease_owner` text NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attempts_status_check" CHECK("job_attempts"."status" in ('running','succeeded','failed','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_attempt_unique` ON `job_attempts` (`job_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dedup_key` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deadline_at` integer,
	`lease_owner` text,
	`lease_expires_at` integer,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`result` text,
	`last_error` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT "jobs_status_check" CHECK("jobs"."status" in ('queued','running','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_dedup` ON `jobs` (`dedup_key`) WHERE "jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`run_after`,`priority`);--> statement-breakpoint
CREATE INDEX `jobs_kind_idx` ON `jobs` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_entity_idx` ON `jobs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`succeeded` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_email_time_idx` ON `login_attempts` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_ip_time_idx` ON `login_attempts` (`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
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
	CONSTRAINT "notifications_kind_check" CHECK("notifications"."kind" in ('task.assigned','task.due_today','task.overdue','note.mentioned','kpi.off_target','job.finished'))
);
--> statement-breakpoint
CREATE INDEX `notifications_feed_idx` ON `notifications` (`user_id`,`read_at`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `notifications_actor_idx` ON `notifications` (`actor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_unread_subject_idx` ON `notifications` (`user_id`,`kind`,`subject_id`) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE TABLE `recovery_token_uses` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`used_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`payload` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_occurrence` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`user_id` text,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_scope_owner_check" CHECK(("settings"."scope" = 'workspace' and "settings"."user_id" is null) or ("settings"."scope" = 'user' and "settings"."user_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `settings_user_idx` ON `settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `settings_actor_idx` ON `settings` (`updated_by`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_login_at` integer,
	`password_changed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('admin','member')),
	CONSTRAINT "users_email_lower_check" CHECK("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`setup_completed_at` integer,
	`setup_token_hash` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`maintenance_mode` integer DEFAULT false NOT NULL,
	CONSTRAINT "workspace_singleton" CHECK("workspace"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `committees` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ownership` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT 'internal' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "committees_name_check" CHECK(length(trim("committees"."name")) between 1 and 500),
	CONSTRAINT "committees_scope_check" CHECK("committees"."scope" in ('internal','external')),
	CONSTRAINT "committees_status_check" CHECK("committees"."status" in ('active','archived')),
	CONSTRAINT "committees_order_check" CHECK("committees"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `committees_name_unique` ON `committees` (lower("name")) WHERE "committees"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `committees_creator_idx` ON `committees` (`created_by`);--> statement-breakpoint
CREATE INDEX `committees_updater_idx` ON `committees` (`updated_by`);--> statement-breakpoint
CREATE INDEX `committees_status_idx` ON `committees` (`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `kpi_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`kpi_id` text NOT NULL,
	`reading_date` text NOT NULL,
	`value` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`kpi_id`) REFERENCES `kpis`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kpi_readings_value_check" CHECK(abs("kpi_readings"."value") < 10000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_readings_date_unique` ON `kpi_readings` (`kpi_id`,`reading_date`) WHERE "kpi_readings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `kpi_readings_kpi_idx` ON `kpi_readings` (`kpi_id`,`reading_date`);--> statement-breakpoint
CREATE INDEX `kpi_readings_creator_idx` ON `kpi_readings` (`created_by`);--> statement-breakpoint
CREATE INDEX `kpi_readings_updater_idx` ON `kpi_readings` (`updated_by`);--> statement-breakpoint
CREATE TABLE `kpi_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`kpi_id` text NOT NULL,
	`year` integer NOT NULL,
	`period` integer NOT NULL,
	`target_value` real NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`kpi_id`) REFERENCES `kpis`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kpi_targets_period_check" CHECK("kpi_targets"."period" between 1 and 12),
	CONSTRAINT "kpi_targets_year_check" CHECK("kpi_targets"."year" between 1900 and 2999),
	CONSTRAINT "kpi_targets_value_check" CHECK(abs("kpi_targets"."target_value") < 10000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_targets_period_unique` ON `kpi_targets` (`kpi_id`,`year`,`period`) WHERE "kpi_targets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `kpi_targets_kpi_idx` ON `kpi_targets` (`kpi_id`,`year`,`period`);--> statement-breakpoint
CREATE INDEX `kpi_targets_creator_idx` ON `kpi_targets` (`created_by`);--> statement-breakpoint
CREATE TABLE `kpis` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`direction` text DEFAULT 'higher' NOT NULL,
	`frequency` text DEFAULT 'quarterly' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`objective_id` text,
	`owner_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kpis_name_check" CHECK(length(trim("kpis"."name")) between 1 and 500),
	CONSTRAINT "kpis_direction_check" CHECK("kpis"."direction" in ('higher', 'lower')),
	CONSTRAINT "kpis_unit_check" CHECK("kpis"."unit" in ('count', 'percent', 'sar', 'usd', 'points')),
	CONSTRAINT "kpis_frequency_check" CHECK("kpis"."frequency" in ('monthly', 'quarterly', 'annual')),
	CONSTRAINT "kpis_order_check" CHECK("kpis"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `kpis_objective_idx` ON `kpis` (`objective_id`);--> statement-breakpoint
CREATE INDEX `kpis_owner_idx` ON `kpis` (`owner_id`);--> statement-breakpoint
CREATE INDEX `kpis_creator_idx` ON `kpis` (`created_by`);--> statement-breakpoint
CREATE INDEX `kpis_updater_idx` ON `kpis` (`updated_by`);--> statement-breakpoint
CREATE INDEX `kpis_name_idx` ON `kpis` (lower("name"),`id`);--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "objectives_name_check" CHECK(length(trim("objectives"."name")) between 1 and 500),
	CONSTRAINT "objectives_order_check" CHECK("objectives"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `objectives_order_idx` ON `objectives` (`sort_order`,`id`);--> statement-breakpoint
CREATE INDEX `objectives_creator_idx` ON `objectives` (`created_by`);--> statement-breakpoint
CREATE INDEX `objectives_updater_idx` ON `objectives` (`updated_by`);--> statement-breakpoint
CREATE TABLE `note_people` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_people_active_idx` ON `note_people` (`note_id`,`person_id`) WHERE "note_people"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `note_people_note_idx` ON `note_people` (`note_id`);--> statement-breakpoint
CREATE INDEX `note_people_person_idx` ON `note_people` (`person_id`);--> statement-breakpoint
CREATE INDEX `note_people_creator_idx` ON `note_people` (`created_by`);--> statement-breakpoint
CREATE TABLE `note_refinements` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`job_id` text NOT NULL,
	`note_revision` integer NOT NULL,
	`content_hash` text NOT NULL,
	`capability_version` integer NOT NULL,
	`refined_content` text NOT NULL,
	`suggested_tasks` text NOT NULL,
	`suggested_tags` text NOT NULL,
	`summary_of_changes` text NOT NULL,
	`status` text NOT NULL,
	`applied_task_ids` text DEFAULT '[]' NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "note_refinements_status_check" CHECK("note_refinements"."status" in ('pending', 'applied', 'discarded', 'stale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_refinements_pending_idx` ON `note_refinements` (`note_id`) WHERE "note_refinements"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `note_refinements_job_idx` ON `note_refinements` (`job_id`);--> statement-breakpoint
CREATE INDEX `note_refinements_note_idx` ON `note_refinements` (`note_id`);--> statement-breakpoint
CREATE INDEX `note_refinements_creator_idx` ON `note_refinements` (`created_by`);--> statement-breakpoint
CREATE INDEX `note_refinements_reviewer_idx` ON `note_refinements` (`reviewed_by`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`committee_id` text,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`type` text,
	`note_date` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notes_title_check" CHECK(length(trim("notes"."title")) between 1 and 500),
	CONSTRAINT "notes_tags_check" CHECK(json_array_length("notes"."tags") <= 10)
);
--> statement-breakpoint
CREATE INDEX `notes_committee_idx` ON `notes` (`committee_id`);--> statement-breakpoint
CREATE INDEX `notes_date_idx` ON `notes` (`note_date`,`created_at`,`id`) WHERE "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `notes_type_idx` ON `notes` (`type`);--> statement-breakpoint
CREATE INDEX `notes_archived_idx` ON `notes` (`archived_at`);--> statement-breakpoint
CREATE INDEX `notes_creator_idx` ON `notes` (`created_by`);--> statement-breakpoint
CREATE INDEX `notes_updater_idx` ON `notes` (`updated_by`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`full_name` text NOT NULL,
	`display_name` text,
	`honorific` text,
	`organization` text,
	`role_title` text,
	`kind` text DEFAULT 'external' NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_assignable` integer DEFAULT false NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_kind_check" CHECK("people"."kind" in ('internal', 'external')),
	CONSTRAINT "people_full_name_check" CHECK(length(trim("people"."full_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_user_id_unique` ON `people` (`user_id`);--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` (lower("full_name"),`id`);--> statement-breakpoint
CREATE INDEX `people_creator_idx` ON `people` (`created_by`);--> statement-breakpoint
CREATE INDEX `people_updater_idx` ON `people` (`updated_by`);--> statement-breakpoint
CREATE TABLE `task_completion_items` (
	`completion_id` text NOT NULL,
	`task_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`previous_completed_at` integer,
	`completed_revision` integer NOT NULL,
	PRIMARY KEY(`completion_id`, `task_id`),
	FOREIGN KEY (`completion_id`) REFERENCES `task_completions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_completion_items_status_check" CHECK("task_completion_items"."previous_status" in ('inbox','next_action','waiting_on','someday','completed'))
);
--> statement-breakpoint
CREATE INDEX `task_completion_items_task_idx` ON `task_completion_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`root_task_id` text NOT NULL,
	`actor_id` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`undone_at` integer,
	FOREIGN KEY (`root_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_completions_status_check" CHECK("task_completions"."status" in ('completed','undone')),
	CONSTRAINT "task_completions_undone_check" CHECK(("task_completions"."status" = 'undone') = ("task_completions"."undone_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `task_completions_root_idx` ON `task_completions` (`root_task_id`);--> statement-breakpoint
CREATE INDEX `task_completions_actor_idx` ON `task_completions` (`actor_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`committee_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`priority` text,
	`due_date` text,
	`completed_at` integer,
	`owner_id` text,
	`parent_id` text,
	`source_note_id` text,
	`sort_order` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_op_id` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_title_check" CHECK(length(trim("tasks"."title")) between 1 and 500),
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('inbox','next_action','waiting_on','someday','completed')),
	CONSTRAINT "tasks_priority_check" CHECK("tasks"."priority" in ('low','medium','high','urgent')),
	CONSTRAINT "tasks_completed_check" CHECK(("tasks"."status" = 'completed') = ("tasks"."completed_at" is not null)),
	CONSTRAINT "tasks_self_check" CHECK("tasks"."parent_id" <> "tasks"."id")
);
--> statement-breakpoint
CREATE INDEX `tasks_committee_idx` ON `tasks` (`committee_id`);--> statement-breakpoint
CREATE INDEX `tasks_owner_idx` ON `tasks` (`owner_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tasks_source_note_idx` ON `tasks` (`source_note_id`);--> statement-breakpoint
CREATE INDEX `tasks_creator_idx` ON `tasks` (`created_by`);--> statement-breakpoint
CREATE INDEX `tasks_updater_idx` ON `tasks` (`updated_by`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`,`id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`,`deleted_at`);--> statement-breakpoint
-- Hand-written objects (ADR 0029). Declared in drizzle/custom-objects.json; the schema audit
-- checks they exist. drizzle-kit's SQLite generator cannot emit an index expression containing a
-- comma, and it never emits triggers.
CREATE UNIQUE INDEX `settings_scope_key` ON `settings` (`key`,`scope`,coalesce(`user_id`, ''));
--> statement-breakpoint
-- TASKS-I02: one position per live sibling set. Replaces the deferrable exclusion constraint;
-- SQLite checks it per statement, so a colliding reorder passes through temporary negative
-- positions first (docs/features/tasks.md).
CREATE UNIQUE INDEX `tasks_active_order_idx` ON `tasks` (coalesce(`parent_id`, ''),`sort_order`) WHERE `deleted_at` is null;
--> statement-breakpoint
-- TASKS-I01: depth one. A task with a parent is a leaf, and its parent is a root. The repo maps
-- the raised message to the same error the PostgreSQL 23514 path produced.
CREATE TRIGGER `tasks_depth_check_insert` BEFORE INSERT ON `tasks` FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL AND (
  NEW.parent_id = NEW.id OR
  EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_id AND parent_id IS NOT NULL) OR
  EXISTS (SELECT 1 FROM tasks WHERE parent_id = NEW.id)
)
BEGIN
  SELECT RAISE(ABORT, 'TASKS-I01 depth one required');
END;
--> statement-breakpoint
CREATE TRIGGER `tasks_depth_check_update` BEFORE UPDATE OF parent_id ON `tasks` FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL AND (
  NEW.parent_id = NEW.id OR
  EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_id AND parent_id IS NOT NULL) OR
  EXISTS (SELECT 1 FROM tasks WHERE parent_id = NEW.id)
)
BEGIN
  SELECT RAISE(ABORT, 'TASKS-I01 depth one required');
END;
