import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { webauthnCredentials, type users } from "../db/schema";

type UserRow = typeof users.$inferSelect;

/**
 * Pending second-factor sign-ins. After the password checks out, the client
 * gets a short-lived ticket bound to the device session that proved the
 * password; the session is only rotated into the account once a TOTP code,
 * recovery code or passkey assertion is verified against that ticket.
 */

export type Ticket = {
  userId: string;
  sessionId: string;
  expiresAt: number;
  attempts: number;
  challenge?: string;
  rpId?: string;
  origin?: string;
};

const TICKET_TTL = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
const tickets = new Map<string, Ticket>();

export function passkeyCount(userId: string) {
  return db.select({ id: webauthnCredentials.id }).from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId)).all().length;
}

export function secondFactorMethods(u: UserRow): string[] {
  const m: string[] = [];
  if (u.totpEnabled === 1 && u.totpSecret) m.push("totp");
  if (passkeyCount(u.id) > 0) m.push("passkey");
  if (m.length && u.recoveryCodes) m.push("recovery");
  return m;
}

export function issueTicket(userId: string, sessionId: string) {
  sweepTickets();
  // One pending sign-in per device session.
  for (const [k, t] of tickets) if (t.sessionId === sessionId) tickets.delete(k);
  const id = crypto.randomBytes(24).toString("base64url");
  tickets.set(id, { userId, sessionId, expiresAt: Date.now() + TICKET_TTL, attempts: 0 });
  return id;
}

/** The ticket, if it exists, has not expired and belongs to this device session. */
export function getTicket(id: unknown, sessionId: string): Ticket | null {
  if (typeof id !== "string") return null;
  const t = tickets.get(id);
  if (!t || t.expiresAt < Date.now() || t.sessionId !== sessionId) return null;
  return t;
}

export function dropTicket(id: string) {
  tickets.delete(id);
}

export function sweepTickets() {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expiresAt < now) tickets.delete(k);
}

/** Last accepted TOTP step per user, so a code cannot be replayed inside its window. */
const lastStep = new Map<string, number>();
export function acceptTotpStep(userId: string, step: number) {
  if ((lastStep.get(userId) ?? -1) >= step) return false;
  lastStep.set(userId, step);
  return true;
}
