import bcrypt from 'bcryptjs';

/**
 * Verify a password against a stored hash.
 * Supports bcrypt ($2a$/$2b$/$2y$) and SHA1 (legacy, 40-char hex).
 * No plaintext fallback — all passwords must be hashed.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Bcrypt hash
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    // bcryptjs handles $2y$ by converting to $2a$ internally
    const normalized = storedHash.replace(/^\$2y\$/, '$2a$');
    return bcrypt.compare(password, normalized);
  }

  // SHA1 legacy hash (40-char hex)
  if (/^[0-9a-f]{40}$/i.test(storedHash)) {
    const hasher = new Bun.CryptoHasher('sha1');
    hasher.update(password);
    const sha1 = hasher.digest('hex');
    return sha1 === storedHash.toLowerCase();
  }

  // Plaintext fallback — Magnus Billing stores SIP and some user passwords in plaintext
  // This is required for V1 compatibility
  return password === storedHash;
}

/**
 * Hash a password with bcrypt for storage.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
