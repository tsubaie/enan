import 'server-only';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { type Database } from './client';
import { signInCodes } from './system-schema';
import { id } from './ids';
// ADMIN-B63: how many codes were asked for by this email and from this address in the window,
// counted apart as login failures are (ADMIN-B20). A null address counts nothing.
export async function codeRequests(database: Database, email: string, address: string | null) {
  const [row] = await database
    .select({
      byEmail: sql<number>`count(*) filter (where ${signInCodes.email} = ${email})`.mapWith(Number),
      byAddress: sql<number>`count(*) filter (where ${signInCodes.ip} = ${address})`.mapWith(
        Number,
      ),
    })
    .from(signInCodes)
    .where(
      and(
        gt(signInCodes.createdAt, new Date(Date.now() - 900000)),
        or(
          eq(signInCodes.email, email),
          address === null ? undefined : eq(signInCodes.ip, address),
        ),
      ),
    );
  return { byEmail: row?.byEmail ?? 0, byAddress: row?.byAddress ?? 0 };
}
// ADR 0055: Better Auth keeps the codes themselves (hashed, in auth_verifications); this table is
// only the log of requests the send throttle counts, written for known and unknown emails alike.
export async function recordCodeRequest(database: Database, email: string, ip: string | null) {
  await database.insert(signInCodes).values({
    id: id(),
    email,
    ip: ip ?? '',
    expiresAt: new Date(Date.now() + 900000),
  });
}
