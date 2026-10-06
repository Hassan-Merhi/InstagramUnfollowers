import { UserNode } from "../model/user";
import { DEFAULT_USERS_PER_SEARCH_CYCLE, INSTAGRAM_ASBD_ID, INSTAGRAM_WEB_APP_ID, UNFOLLOWERS_PER_PAGE, WITHOUT_PROFILE_PICTURE_URL_IDS } from "../constants/constants";
import { ScanningTab } from "../model/scanning-tab";
import { ScanningFilter } from "../model/scanning-filter";
import { UnfollowLogEntry } from "../model/unfollow-log-entry";
import { UnfollowFilter } from "../model/unfollow-filter";

const normalizeUsername = (username: string): string =>
  username.replace(/^@+/, "").trim().toLowerCase();

const downloadTextFile = (content: string, mimeType: string, filename: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const exportDateStamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

export async function copyListToClipboard(
  nonFollowersList: readonly UserNode[],
  alertMessage: string = "List copied to clipboard!",
): Promise<void> {
  const output = [...nonFollowersList]
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(user => user.username)
    .join("\n");

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(output);
    } else {
      throw new Error("Clipboard API unavailable");
    }
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = output;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  alert(alertMessage);
}

export function exportToJSON(users: readonly UserNode[]): void {
  downloadTextFile(
    JSON.stringify(users, null, 2),
    "application/json;charset=utf-8",
    `instagram_unfollowers_${exportDateStamp()}.json`,
  );
}

const csvEscape = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function exportToCSV(users: readonly UserNode[]): void {
  const headers = ["id", "username", "full_name", "is_verified", "is_private", "profile_pic_url"];
  const rows = users.map(user => [
    user.id,
    user.username,
    user.full_name,
    user.is_verified,
    user.is_private,
    user.profile_pic_url,
  ]);

  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map(row => row.map(csvEscape).join(",")),
  ].join("\r\n");

  downloadTextFile(
    csv,
    "text/csv;charset=utf-8",
    `instagram_unfollowers_${exportDateStamp()}.csv`,
  );
}

export function getMaxPage(nonFollowersList: readonly UserNode[]): number {
  const pageCalc = Math.ceil(nonFollowersList.length / UNFOLLOWERS_PER_PAGE);
  return pageCalc < 1 ? 1 : pageCalc;
}

export function getCurrentPageUnfollowers(nonFollowersList: readonly UserNode[], currentPage: number): readonly UserNode[] {
  const sortedList = [...nonFollowersList].sort((a, b) => a.username.localeCompare(b.username));
  const safePage = Math.min(Math.max(currentPage, 1), getMaxPage(sortedList));
  const start = UNFOLLOWERS_PER_PAGE * (safePage - 1);
  return sortedList.slice(start, start + UNFOLLOWERS_PER_PAGE);
}

export function isWithoutProfilePicture(user: UserNode): boolean {
  return WITHOUT_PROFILE_PICTURE_URL_IDS.some(id => user.profile_pic_url.includes(id));
}

export function getUsersForDisplay(
  results: readonly UserNode[],
  whitelistedResults: readonly UserNode[],
  currentTab: ScanningTab,
  searchTerm: string,
  filter: ScanningFilter,
): readonly UserNode[] {
  const users: UserNode[] = [];
  const whitelistedIds = new Set(whitelistedResults.map(user => user.id));
  const whitelistedUsernames = new Set(
    whitelistedResults.map(user => normalizeUsername(user.username)),
  );
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  for (const result of results) {
    const isWhitelisted =
      whitelistedIds.has(result.id) ||
      whitelistedUsernames.has(normalizeUsername(result.username));
    switch (currentTab) {
      case "non_whitelisted":
        if (isWhitelisted) {
          continue;
        }
        break;
      case "whitelisted":
        if (!isWhitelisted) {
          continue;
        }
        break;
      default:
        assertUnreachable(currentTab);
    }
    if (!filter.showPrivate && result.is_private) {
      continue;
    }
    if (!filter.showPublic && !result.is_private) {
      continue;
    }
    if (!filter.showVerified && result.is_verified) {
      continue;
    }
    // Scans only keep accounts that don't follow back; this also hides
    // mutuals stored by older cached scans.
    if (result.follows_viewer) {
      continue;
    }
    if (!filter.showWithOutProfilePicture && isWithoutProfilePicture(result)) {
      continue;
    }
    const userMatchesSearchTerm =
      result.username.toLowerCase().includes(normalizedSearchTerm) ||
      result.full_name.toLowerCase().includes(normalizedSearchTerm);
    if (normalizedSearchTerm !== "" && !userMatchesSearchTerm) {
      continue;
    }
    users.push(result);
  }
  return users;
}

export function getUnfollowLogForDisplay(log: readonly UnfollowLogEntry[], searchTerm: string, filter: UnfollowFilter) {
  const entries: UnfollowLogEntry[] = [];
  for (const entry of log) {
    if (!filter.showSucceeded && entry.unfollowedSuccessfully) {
      continue;
    }
    if (!filter.showFailed && !entry.unfollowedSuccessfully) {
      continue;
    }
    const userMatchesSearchTerm = entry.user.username.toLowerCase().includes(searchTerm.toLowerCase());
    if (searchTerm !== "" && !userMatchesSearchTerm) {
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * When writing a switch-case with a finite number of cases, use this function in the
 * `default` clause of switch-case statements for exhaustive checking. This will make
 * TS complain until ALL cases are handled. For example, if we have a switch-case
 * in-which we evaluate every possible status of a component's state, if we add this
 * to the default clause and then add a new status to the state type, TS will complain
 * and force us to handle it as well, thus avoiding forgetting it.
 */
export function assertUnreachable(_value: never): never {
  throw new Error('Statement should be unreachable');
}

export function sleep(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length !== 2) {
    return null;
  }
  return parts.pop()!.split(';').shift()!;
}

export function unfollowUserUrlGenerator(idToUnfollow: string): string {
  return `https://www.instagram.com/api/v1/friendships/destroy/${idToUnfollow}/`;
}

export function legacyUnfollowUserUrlGenerator(idToUnfollow: string): string {
  return `https://www.instagram.com/web/friendships/${idToUnfollow}/unfollow/`;
}

export type FriendshipsListKind = 'following' | 'followers';

/**
 * A single user entry as returned by Instagram's private
 * /api/v1/friendships/<id>/following|followers/ REST endpoints. This is a
 * different (and much less rich) shape than the old public GraphQL
 * following-edges endpoint this app used to call, which was the actual
 * cause of scans always completing instantly with 0 results: that GraphQL
 * `query_hash` is a years-old, publicly-known value that Instagram now
 * serves as a structurally-valid but data-empty response (200 OK, correct
 * total count, zero edges, has_next_page: false) rather than an outright
 * error, so the old code had no way to detect the failure.
 */
export interface RawFriendshipUser {
  readonly pk: string | number;
  readonly pk_id?: string;
  readonly username: string;
  readonly full_name?: string;
  readonly profile_pic_url: string;
  readonly is_private?: boolean;
  readonly is_verified?: boolean;
}

export interface FriendshipsPage {
  readonly users?: readonly RawFriendshipUser[];
  // Instagram sometimes omits next_max_id even when has_more is true right
  // at the very end of a list; both are checked when deciding to continue.
  readonly next_max_id?: string | number;
  readonly has_more?: boolean;
}

// `userId` defaults to the logged-in viewer; pass another account's id to read
// that account's following/followers list instead.
export function friendshipsUrlGenerator(kind: FriendshipsListKind, maxId?: string, count: number = DEFAULT_USERS_PER_SEARCH_CYCLE, userId?: string): string {
  const targetId = userId ?? getCookie('ds_user_id');
  const base = `https://www.instagram.com/api/v1/friendships/${targetId}/${kind}/?count=${count}`;
  return maxId === undefined ? base : `${base}&max_id=${encodeURIComponent(maxId)}`;
}

export class InstagramApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, InstagramApiError.prototype);
    this.name = 'InstagramApiError';
    this.status = status;
  }
}

export interface FriendshipStatus {
  readonly status?: string;
  readonly following: boolean;
  readonly followed_by?: boolean;
  readonly incoming_request?: boolean;
  readonly outgoing_request?: boolean;
  readonly is_private?: boolean;
}

export async function fetchFriendshipStatus(userId: string): Promise<FriendshipStatus> {
  const csrftoken = getCookie('csrftoken') || '';
  const headers: Record<string, string> = {
    'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
    'X-ASBD-ID': INSTAGRAM_ASBD_ID,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
  };
  if (csrftoken) {
    headers['X-CSRFToken'] = csrftoken;
  }

  const response = await fetch(`https://www.instagram.com/api/v1/friendships/show/${encodeURIComponent(userId)}/`, {
    credentials: 'same-origin',
    headers,
  });
  if (!response.ok) {
    throw new InstagramApiError(response.status, `Instagram returned HTTP ${response.status} while verifying friendship status`);
  }

  const data = (await response.json()) as any;
  if (data?.status === 'fail' || typeof data?.following !== 'boolean') {
    throw new InstagramApiError(
      response.status,
      data?.message || 'Instagram returned an invalid friendship status response',
    );
  }
  return data as FriendshipStatus;
}

export async function fetchFriendshipsPage(kind: FriendshipsListKind, maxId?: string, count?: number, userId?: string): Promise<FriendshipsPage> {
  const csrftoken = getCookie('csrftoken') || '';
  const headers: Record<string, string> = {
    'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
    'X-ASBD-ID': INSTAGRAM_ASBD_ID,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
  };
  if (csrftoken) {
    headers['X-CSRFToken'] = csrftoken;
  }

  const response = await fetch(friendshipsUrlGenerator(kind, maxId, count, userId), {
    credentials: 'same-origin',
    headers,
  });
  const rawBody = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(rawBody);
  } catch {
    // HTML/login/error pages are handled below as an invalid response.
  }

  if (!response.ok) {
    throw new InstagramApiError(
      response.status,
      data?.message || `Instagram returned HTTP ${response.status} while fetching ${kind}`,
    );
  }
  if (data?.status === 'fail' || !Array.isArray(data?.users)) {
    throw new InstagramApiError(
      response.status,
      data?.message || `Instagram returned an invalid response while fetching ${kind}`,
    );
  }
  return data as FriendshipsPage;
}

export function rawFriendshipUserToUserNode(raw: RawFriendshipUser, followsViewer: boolean): UserNode {
  return {
    id: String(raw.pk_id ?? raw.pk),
    username: raw.username,
    full_name: raw.full_name ?? '',
    profile_pic_url: raw.profile_pic_url,
    is_private: raw.is_private ?? false,
    is_verified: raw.is_verified ?? false,
    // These endpoints don't expose either of these, and nothing in the app
    // reads them beyond this mapping, so they're set to the values that are
    // true by construction for entries drawn from your own following list.
    followed_by_viewer: true,
    requested_by_viewer: false,
    follows_viewer: followsViewer,
  };
}
