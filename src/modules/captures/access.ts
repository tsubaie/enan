import 'server-only';
import { AppError } from '@/core/http/errors';
import type { User } from '@/core/http/user-schema';
import type { CaptureRow } from './repo';
type Reader = Pick<User, 'id' | 'role'>;
type Owned = Pick<CaptureRow, 'createdBy' | 'deletedAt'>;
// CAPTURES-B02: a draft is the recorder's and the administrators' alone. This is the row-level
// twin of `visibleCaptures` in the repo, which lists and counts use; the two must agree.
export function canViewCapture(user: Reader, capture: Owned | undefined): capture is Owned {
  if (!capture || capture.deletedAt) return false;
  return user.role === 'admin' || capture.createdBy === user.id;
}
// Whoever may see a draft may act on it; kept separate so a narrower rule has one place to go.
export function canMutateCapture(user: Reader, capture: Owned | undefined): capture is Owned {
  return canViewCapture(user, capture);
}
// Missing, deleted and someone else's all answer the same `not_found`, so an id reveals nothing.
export function assertCaptureAccess<T extends Owned>(user: Reader, capture: T | undefined): T {
  if (!canViewCapture(user, capture)) throw new AppError('not_found', { entityType: 'capture' });
  return capture;
}
