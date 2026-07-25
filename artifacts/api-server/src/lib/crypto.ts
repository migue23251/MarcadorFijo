import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT = "radarbet-gemini-key-salt";

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || "default-dev-key-change-in-production";
  return scryptSync(secret, SALT, 32);
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = encrypted.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Invalid encrypted data format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encryptedBuffer = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encryptedBuffer) + decipher.final("utf8");
}
