import 'server-only';
import { SignInMethod, type SignInMethod as Method } from '@/core/config/sign-in-schema';
import { type Database } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { AppError } from '@/core/http/errors';
import { mailStatus } from '@/core/mail/settings';
// ADMIN-B64: a method is offered when an administrator chose it and the server can serve it:
// password always, a code once mail is set up, Google once its client is. Should every chosen
// method become unservable (mail removed after password was turned off), password comes back, so
// no configuration change can leave a workspace with no way in. RECOVERY_TOKEN works regardless.
export async function signInMethods(database: Database) {
  const available: Record<Method, boolean> = {
    password: true,
    code: (await mailStatus(database)).source !== 'none',
    google: false,
  };
  const chosen = await getSetting(database, 'auth.sign_in_methods');
  const enabled = SignInMethod.options.filter(
    (method) => chosen.includes(method) && available[method],
  );
  const fallback: Method[] = ['password'];
  return { chosen, available, enabled: enabled.length > 0 ? enabled : fallback };
}
export async function requireMethod(database: Database, method: Method) {
  if (!(await signInMethods(database)).enabled.includes(method))
    throw new AppError('forbidden', { reason: 'sign_in_method' });
}
// An administrator may only switch on a method the server can serve right now. One already chosen
// stays chosen while it cannot be served (the default chooses every method), so it takes effect
// once the server can serve it, as it would have had nobody changed the setting.
export async function requireAvailable(database: Database, methods: readonly Method[]) {
  const { available, chosen } = await signInMethods(database);
  const missing = methods.filter((method) => !available[method] && !chosen.includes(method));
  if (missing.length > 0)
    throw new AppError('rule_violation', {
      reason: 'sign_in_method_unavailable',
      methods: missing,
    });
}
