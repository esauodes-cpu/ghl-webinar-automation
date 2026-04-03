import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM  = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH  = 12;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY not set.");
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH) throw new Error("ENCRYPTION_KEY must be 64 hex characters.");
  return key;
}

export function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv  = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const key   = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format.");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}