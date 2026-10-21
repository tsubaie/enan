-- docs/03 § schedules: the system jobs the scheduler runs. Times are UTC; the ids are fixed so a
-- restored backup and a fresh install agree on them.
INSERT INTO `schedules` (`id`, `kind`, `cron`, `timezone`, `payload`) VALUES
  ('01a15e03-3f4b-7352-ba81-c6d3d70f05b9', 'system.backup', '0 2 * * *', 'UTC', '{}'),
  ('01a15e03-3f4c-70fc-9d03-73e2f1f68bf2', 'system.prune', '0 3 * * *', 'UTC', '{}'),
  ('01a15e03-3f4c-70fc-9d03-74d86ef0706d', 'system.notifications_purge', '15 3 * * *', 'UTC', '{}')
ON CONFLICT (`id`) DO NOTHING;
