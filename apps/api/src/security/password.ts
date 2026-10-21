import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id configuration following OWASP recommendations:
 * memoryCost: 19456 KiB (19 MiB), timeCost: 2 iterations, parallelism: 1
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, candidatePassword: string): Promise<boolean> {
  try {
    return await verify(passwordHash, candidatePassword);
  } catch {
    return false;
  }
}
