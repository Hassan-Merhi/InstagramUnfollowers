import { UserNode } from "../model/user";
import { Timings } from "../model/timings";
import { WHITELISTED_RESULTS_STORAGE_KEY, TIMINGS_STORAGE_KEY, LAST_SCAN_RESULTS_STORAGE_KEY, LAST_SCAN_TIMESTAMP_STORAGE_KEY, SCAN_SESSION_STORAGE_KEY } from "../constants/constants";
import { ScanningFilter } from "../model/scanning-filter";
import { ScanningTab } from "../model/scanning-tab";

const MAX_WHITELIST_IMPORT_BYTES = 5 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeWhitelistUser = (value: unknown): UserNode | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const username = typeof value.username === "string" ? value.username.replace(/^@+/, "").trim().toLowerCase() : "";
  if (id === "" || username === "" || !/^[a-zA-Z0-9._]+$/.test(username)) {
    return null;
  }
  return {
    id,
    username,
    full_name: typeof value.full_name === "string" ? value.full_name : username,
    profile_pic_url: typeof value.profile_pic_url === "string" ? value.profile_pic_url : "",
    is_private: typeof value.is_private === "boolean" ? value.is_private : false,
    is_verified: typeof value.is_verified === "boolean" ? value.is_verified : false,
    followed_by_viewer: typeof value.followed_by_viewer === "boolean" ? value.followed_by_viewer : true,
    follows_viewer: typeof value.follows_viewer === "boolean" ? value.follows_viewer : false,
    requested_by_viewer: typeof value.requested_by_viewer === "boolean" ? value.requested_by_viewer : false,
  };
};

const normalizeWhitelistArray = (value: unknown): readonly UserNode[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value.map(normalizeWhitelistUser);
  if (normalized.some(user => user === null)) {
    return null;
  }
  const ids = new Set<string>();
  const usernames = new Set<string>();
  const unique: UserNode[] = [];
  for (const user of normalized as UserNode[]) {
    if (ids.has(user.id) || usernames.has(user.username)) {
      continue;
    }
    ids.add(user.id);
    usernames.add(user.username);
    unique.push(user);
  }
  return unique;
};

const isCachedUser = (value: unknown): value is UserNode => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.username === "string" &&
    value.username.length > 0 &&
    typeof value.full_name === "string" &&
    typeof value.profile_pic_url === "string" &&
    typeof value.is_private === "boolean" &&
    typeof value.is_verified === "boolean" &&
    typeof value.followed_by_viewer === "boolean" &&
    typeof value.follows_viewer === "boolean" &&
    typeof value.requested_by_viewer === "boolean"
  );
};

/**
 * Export whitelist to a JSON file
 */
export const exportWhitelist = (whitelistedUsers: readonly UserNode[]): void => {
  if (whitelistedUsers.length === 0) {
    alert("No users in whitelist to export");
    return;
  }

  const dataStr = JSON.stringify(whitelistedUsers, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = `instagram-whitelist-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
};

/**
 * Import whitelist from a JSON file
 */
export const importWhitelist = (
  file: File,
  onSuccess: (users: readonly UserNode[]) => void,
  onError: (message: string) => void
): void => {
  if (file.size > MAX_WHITELIST_IMPORT_BYTES) {
    onError("Whitelist file is too large (maximum 5 MB)");
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const content = typeof e.target?.result === "string" ? e.target.result : "";
      const parsed: unknown = JSON.parse(content);
      const importedUsers = normalizeWhitelistArray(parsed);
      if (importedUsers === null) {
        onError("Invalid whitelist format: every entry must contain a valid id and username");
        return;
      }
      onSuccess(importedUsers);
    } catch (error) {
      onError(`Failed to parse JSON file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };
  
  reader.onerror = () => {
    onError("Failed to read file");
  };
  
  reader.readAsText(file);
};

/**
 * Clear all whitelist data
 */
export const clearWhitelist = (): void => {
  if (!confirm("Are you sure you want to clear the entire whitelist? This action cannot be undone.")) {
    return;
  }
  
  localStorage.removeItem(WHITELISTED_RESULTS_STORAGE_KEY);
};

/**
 * Load whitelist from localStorage
 */
export const loadWhitelist = (): readonly UserNode[] => {
  try {
    const raw = localStorage.getItem(WHITELISTED_RESULTS_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    return normalizeWhitelistArray(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
};

/**
 * Save whitelist to localStorage
 */
export const saveWhitelist = (whitelistedUsers: readonly UserNode[]): void => {
  localStorage.setItem(WHITELISTED_RESULTS_STORAGE_KEY, JSON.stringify(whitelistedUsers));
};

/**
 * Merge imported whitelist with existing whitelist (avoiding duplicates)
 */
export const mergeWhitelists = (
  existing: readonly UserNode[],
  imported: readonly UserNode[]
): readonly UserNode[] => {
  const existingIds = new Set(existing.map(user => user.id));
  const existingUsernames = new Set(existing.map(user => user.username.trim().toLowerCase()));
  const uniqueImported = imported.filter(user => {
    const username = user.username.trim().toLowerCase();
    if (existingIds.has(user.id) || existingUsernames.has(username)) {
      return false;
    }
    existingIds.add(user.id);
    existingUsernames.add(username);
    return true;
  });
  return [...existing, ...uniqueImported];
};

const isFiniteNumberInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isTimings = (value: unknown): value is Timings => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumberInRange(value.timeBetweenSearchCycles, 500, 999999) &&
    isFiniteNumberInRange(value.timeToWaitAfterFiveSearchCycles, 4000, 999999) &&
    isFiniteNumberInRange(value.timeBetweenUnfollows, 1000, 999999) &&
    isFiniteNumberInRange(value.timeToWaitAfterFiveUnfollows, 70000, 999999) &&
    (value.usersPerSearchCycle === undefined ||
      isFiniteNumberInRange(value.usersPerSearchCycle, 1, 200))
  );
};

/**
 * Load timings from localStorage
 */
export const loadTimings = (): Timings | null => {
  const timingsFromStorage = localStorage.getItem(TIMINGS_STORAGE_KEY);

  if (timingsFromStorage === null) {
    return null;
  }

  try {
    const parsedTimings: unknown = JSON.parse(timingsFromStorage);
    return isTimings(parsedTimings) ? parsedTimings : null;
  } catch {
    return null;
  }
};

/**
 * Save timings to localStorage
 */
export const saveTimings = (timings: Timings): void => {
  localStorage.setItem(TIMINGS_STORAGE_KEY, JSON.stringify(timings));
};

/**
 * Cache completed scan results locally for instant recall
 */
export const saveCachedScanResults = (results: readonly UserNode[]): void => {
  try {
    localStorage.setItem(LAST_SCAN_RESULTS_STORAGE_KEY, JSON.stringify(results));
    localStorage.setItem(LAST_SCAN_TIMESTAMP_STORAGE_KEY, String(Date.now()));
  } catch (e) {
    console.warn("Could not cache scan results:", e);
  }
};

/**
 * Load cached scan results from localStorage
 */
export const loadCachedScanResults = (): { results: readonly UserNode[]; timestamp: number } | null => {
  try {
    const raw = localStorage.getItem(LAST_SCAN_RESULTS_STORAGE_KEY);
    const time = localStorage.getItem(LAST_SCAN_TIMESTAMP_STORAGE_KEY);
    if (!raw || !time) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    const timestamp = Number(time);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isCachedUser) ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      return null;
    }
    return {
      results: parsed,
      timestamp,
    };
  } catch {
    return null;
  }
};


export const clearCachedScanResults = (): void => {
  try {
    localStorage.removeItem(LAST_SCAN_RESULTS_STORAGE_KEY);
    localStorage.removeItem(LAST_SCAN_TIMESTAMP_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

export interface ScanSessionSnapshot {
  readonly page: number;
  readonly currentTab: ScanningTab;
  readonly searchTerm: string;
  readonly selectedIds: readonly string[];
  readonly filter: ScanningFilter;
  readonly scanIncomplete: boolean;
  readonly timestamp: number;
}

const isScanSessionSnapshot = (value: unknown): value is ScanSessionSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Partial<ScanSessionSnapshot>;
  const filter = snapshot.filter as Partial<ScanningFilter> | undefined;
  return (
    Number.isInteger(snapshot.page) &&
    Number(snapshot.page) >= 1 &&
    (snapshot.currentTab === "non_whitelisted" || snapshot.currentTab === "whitelisted") &&
    typeof snapshot.searchTerm === "string" &&
    snapshot.searchTerm.length <= 500 &&
    Array.isArray(snapshot.selectedIds) &&
    snapshot.selectedIds.every(id => typeof id === "string") &&
    filter !== undefined &&
    typeof filter.showVerified === "boolean" &&
    typeof filter.showPrivate === "boolean" &&
    typeof filter.showPublic === "boolean" &&
    typeof filter.showWithOutProfilePicture === "boolean" &&
    typeof snapshot.scanIncomplete === "boolean" &&
    typeof snapshot.timestamp === "number" &&
    Number.isFinite(snapshot.timestamp) &&
    snapshot.timestamp > 0
  );
};

export const saveScanSession = (snapshot: ScanSessionSnapshot): void => {
  try {
    sessionStorage.setItem(SCAN_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn("Could not save scan session:", e);
  }
};

export const loadScanSession = (): ScanSessionSnapshot | null => {
  try {
    const raw = sessionStorage.getItem(SCAN_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isScanSessionSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const clearScanSession = (): void => {
  try {
    sessionStorage.removeItem(SCAN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};
