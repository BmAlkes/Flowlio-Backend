import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts third-party OAuth tokens (Google Calendar) before they are stored.
// Values written before encryption was introduced have no prefix and are read as-is,
// then re-encrypted by the caller (see googleCalendar.service getUserTokens).
const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required to encrypt tokens");
  return createHash("sha256").update("flowlio-oauth-tokens:" + secret).digest();
}

export const isEncryptedToken = (value: string) => value.startsWith(PREFIX);

export function encryptToken(value: string): string;
export function encryptToken(value: string | null | undefined): string | null | undefined;
export function encryptToken(value: string | null | undefined) {
  if (value == null || value === "" || isEncryptedToken(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map(part => part.toString("base64url")).join(".");
}

export function decryptToken(value: string): string;
export function decryptToken(value: string | null | undefined): string | null | undefined;
export function decryptToken(value: string | null | undefined) {
  if (value == null || !isEncryptedToken(value)) return value;
  const [iv, tag, data] = value.slice(PREFIX.length).split(".").map(part => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
