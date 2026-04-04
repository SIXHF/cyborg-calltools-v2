import { DEFAULT_PERMISSIONS, type Permissions } from '@calltools/shared';
import { readFile } from 'fs/promises';

const PERMISSIONS_FILE = process.env.PERMISSIONS_FILE ?? '/opt/calltools-v2-permissions.json';

interface PermissionsConfig {
  defaults?: Partial<Permissions>;
  admin_restrictions?: Record<string, Partial<Permissions>>;
  user_restrictions?: Record<string, Record<string, Partial<Permissions>>>;
  ip_restrictions?: {
    users?: Record<string, string[]>;
    sip_users?: Record<string, string[]>;
  };
  allowed_accounts?: string[];
  rate_limit_whitelist?: string[];
  audio_approvals?: {
    pending: string[];
    approved: string[];
  };
}

let cachedConfig: PermissionsConfig | null = null;
let cacheTime = 0;
const CACHE_TTL = 10_000; // 10 seconds

export async function loadPermissions(): Promise<PermissionsConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL) return cachedConfig;

  try {
    const raw = await readFile(PERMISSIONS_FILE, 'utf-8');
    cachedConfig = JSON.parse(raw);
    cacheTime = now;
    return cachedConfig!;
  } catch {
    // Return empty config if file doesn't exist yet
    cachedConfig = {};
    cacheTime = now;
    return cachedConfig;
  }
}

/** Invalidate the permission cache — call after writing to the permissions file */
export function invalidatePermissionCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

/**
 * Resolve permissions for a specific user/SIP combination.
 * Cascade: defaults → admin_restrictions → user_restrictions
 */
export async function resolvePermissions(
  role: string,
  sipUser?: string,
  userId?: string
): Promise<Record<string, boolean>> {
  const config = await loadPermissions();
  const perms = { ...DEFAULT_PERMISSIONS, ...config.defaults };

  // Admin restrictions for specific SIP user
  if (sipUser && config.admin_restrictions?.[sipUser]) {
    Object.assign(perms, config.admin_restrictions[sipUser]);
  }

  // User-level restrictions for their SIP users (can only BLOCK, not re-enable — V1 parity)
  if (userId && sipUser && config.user_restrictions?.[userId]?.[sipUser]) {
    const userRest = config.user_restrictions[userId][sipUser];
    for (const [key, val] of Object.entries(userRest)) {
      if (!val) (perms as any)[key] = false;
    }
  }

  return perms as unknown as Record<string, boolean>;
}
