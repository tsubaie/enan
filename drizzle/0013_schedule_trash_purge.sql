-- ADMIN-B48 TASKS-B11: the trash past `retention.trash_days` is purged nightly, after the prune.
-- The id is fixed so a restored backup and a fresh install agree.
INSERT INTO `schedules` (`id`, `kind`, `cron`, `timezone`, `payload`) VALUES
  ('01a17d2c-7a3e-7b51-8c2d-5f9e0b4a6d13', 'system.trash_purge', '30 3 * * *', 'UTC', '{}')
ON CONFLICT (`id`) DO NOTHING;
