/**
 * Admin-issued password reset (ADR-0036): makes a new temporary password for a user who forgot
 * theirs or is locked out. Used by the Users page (users.service.ts) and by the super admin for an
 * organization's admins (super-admin/organizations.service.ts).
 *
 * The password is generated here, never typed by the admin, so nobody picks a weak or reused one.
 * It is returned ONCE to the admin who asked (to hand over in person or by phone) and is never
 * stored in plain text or written to the audit log. The user must change it at the next login
 * (must_change_password, ADR-0028).
 */
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { Db } from '../../prisma/prisma.service';

/** Letters and digits that can't be confused when read aloud or copied (no 0/O, 1/l/I). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * A random password like "Kq7m-Xp3d-Rt9w": 12 characters (about 69 bits), in groups of 4 so it
 * is easy to read out. Always has a capital, a small letter and a digit.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    const password = [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) return password;
  }
}

/**
 * Gives the user a new temporary password, inside the caller's transaction (the caller writes
 * the audit entry):
 *   - the old password stops working,
 *   - they must change the new one at the next login,
 *   - a lockout from failed logins is lifted (that is often why they asked),
 *   - every open session ends, so a stolen token or a forgotten logged-in computer is out too.
 */
export async function issueTemporaryPassword(db: Db, userId: string): Promise<string> {
  const temporaryPassword = generateTemporaryPassword();
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
    },
  });
  await db.loginSession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date() },
  });
  return temporaryPassword;
}
