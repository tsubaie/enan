-- ADMIN-B59: the updater's outcomes become notifications for administrators within five minutes.
-- The id is fixed so a restored backup and a fresh install agree.
INSERT INTO `schedules` (`id`, `kind`, `cron`, `timezone`, `payload`) VALUES
  ('01a17d2c-5e1b-7c3a-9f4e-2b8d6c0a1e57', 'users.updates', '*/5 * * * *', 'UTC', '{}')
ON CONFLICT (`id`) DO NOTHING;
