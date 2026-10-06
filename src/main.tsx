import React, { ChangeEvent, useEffect, useRef, useState } from "react";
import { render } from "react-dom";
import "./styles.scss";

import { Typename, UserNode } from "./model/user";
import { Toast } from "./components/Toast";
import { UserCheckIcon } from "./components/icons/UserCheckIcon";
import { UserUncheckIcon } from "./components/icons/UserUncheckIcon";
import {
  DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
  DEFAULT_TIME_BETWEEN_UNFOLLOWS,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
  DEFAULT_USERS_PER_SEARCH_CYCLE,
  FOLLOWING_PAGE_SAFETY_LIMIT,
  MAX_CONSECUTIVE_EMPTY_PAGES,
  CHECKS_BEFORE_LONG_SLEEP,
  INSTAGRAM_ASBD_ID,
  INSTAGRAM_HOSTNAME,
  INSTAGRAM_WEB_APP_ID,
  RATE_LIMIT_COOLDOWN_SECONDS,
} from "./constants/constants";
import {
  assertUnreachable,
  fetchFriendshipsPage,
  fetchFriendshipStatus,
  FriendshipsPage,
  getCookie,
  getCurrentPageUnfollowers,
  getMaxPage,
  getUsersForDisplay,
  InstagramApiError,
  RawFriendshipUser,
  rawFriendshipUserToUserNode,
  sleep,
  legacyUnfollowUserUrlGenerator,
  unfollowUserUrlGenerator,
} from "./utils/utils";
import { NotSearching } from "./components/NotSearching";
import { State } from "./model/state";
import { Searching } from "./components/Searching";
import { Toolbar } from "./components/Toolbar";
import { Unfollowing } from "./components/Unfollowing";
import { Timings } from "./model/timings";
import { clearScanSession, loadCachedScanResults, loadScanSession, loadTimings, loadWhitelist, saveCachedScanResults, saveScanSession, saveTimings, saveWhitelist } from "./utils/whitelist-manager";
import { getInitialLanguage, Language, saveLanguage, t } from "./utils/i18n";

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocalPreview = LOCAL_PREVIEW_HOSTS.has(location.hostname);

const _avatarUrl = (seed: string): string =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0f172a,1f2937,312e81&fontFamily=Verdana`;

const _createPreviewUser = (
  id: string,
  username: string,
  fullName: string,
  options: { readonly isPrivate?: boolean; readonly isVerified?: boolean; readonly followsViewer?: boolean } = {},
): UserNode => ({
  id,
  username,
  full_name: fullName,
  profile_pic_url: _avatarUrl(username),
  is_private: options.isPrivate ?? false,
  is_verified: options.isVerified ?? false,
  followed_by_viewer: true,
  follows_viewer: options.followsViewer ?? false,
  requested_by_viewer: false,
  reel: {
    id,
    expiring_at: 0,
    has_pride_media: false,
    latest_reel_media: 0,
    seen: null,
    owner: {
      __typename: Typename.GraphUser,
      id,
      profile_pic_url: _avatarUrl(username),
      username,
    },
  },
});

const _getPreviewUsers = (): readonly UserNode[] => [
  _createPreviewUser("1", "alina.frames", "Alina Moreno", { isVerified: true }),
  _createPreviewUser("2", "brassandbone", "Theo Walsh", { isPrivate: true }),
  _createPreviewUser("3", "citrus.archive", "Mara Kim", { followsViewer: true }),
  _createPreviewUser("4", "dawnledger", "Jon Bell", { isPrivate: true }),
  _createPreviewUser("5", "elias.market", "Elias Noor", { isVerified: true }),
  _createPreviewUser("6", "fieldnotes.studio", "Nadia Reyes"),
  _createPreviewUser("7", "glint.supply", "Remy Park", { followsViewer: true }),
  _createPreviewUser("8", "harbor.sequence", "Ivy Chen", { isPrivate: true }),
  _createPreviewUser("9", "inkline.daily", "Sofia Grant"),
  _createPreviewUser("10", "juniper.signal", "Cal Reed", { isVerified: true }),
  _createPreviewUser("11", "keystone.labs", "Mina Torres"),
  _createPreviewUser("12", "lowlight.club", "Owen Voss", { isPrivate: true }),
];

const getInitialAppState = (): State => {
  if (isLocalPreview && new URLSearchParams(location.search).get("preview") === "scanning") {
    const previewUsers = _getPreviewUsers();
    return {
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 100,
      isScanningActive: false,
      results: previewUsers,
      selectedResults: previewUsers.slice(0, 3),
      whitelistedResults: previewUsers.slice(10, 12),
      filter: {
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    };
  }

  const restored = loadScanSession();
  const cachedScan = loadCachedScanResults();
  if (restored !== null && cachedScan !== null) {
    const whitelistedResults = loadWhitelist();
    const selectedIds = new Set(restored.selectedIds);
    const selectedResults = cachedScan.results.filter(user => selectedIds.has(user.id));
    const displayed = getUsersForDisplay(
      cachedScan.results,
      whitelistedResults,
      restored.currentTab,
      restored.searchTerm,
      restored.filter,
    );
    return {
      status: "scanning",
      page: Math.min(Math.max(restored.page, 1), getMaxPage(displayed)),
      searchTerm: restored.searchTerm,
      currentTab: restored.currentTab,
      percentage: 100,
      isScanningActive: false,
      scanIncomplete: false,
      results: cachedScan.results,
      selectedResults,
      whitelistedResults,
      filter: restored.filter,
    };
  }

  return { status: "initial" };
};

function App() {
  const [state, setState] = useState<State>(() => getInitialAppState());
  const scanningPausedRef = useRef(false);
  const [scanningPaused, setScanningPaused] = useState(false);

  const pauseScan = () => {
    const nextPaused = !scanningPausedRef.current;
    scanningPausedRef.current = nextPaused;
    setScanningPaused(nextPaused);
  };

  const [toast, setToast] = useState<{ readonly show: false } | { readonly show: true; readonly text: string }>({
    show: false,
  });

  const [timings, setTimings] = useState<Timings>(() => {
    const storedTimings = loadTimings();
    return {
      timeBetweenSearchCycles: storedTimings?.timeBetweenSearchCycles ?? DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
      timeToWaitAfterFiveSearchCycles: storedTimings?.timeToWaitAfterFiveSearchCycles ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
      timeBetweenUnfollows: storedTimings?.timeBetweenUnfollows ?? DEFAULT_TIME_BETWEEN_UNFOLLOWS,
      timeToWaitAfterFiveUnfollows: storedTimings?.timeToWaitAfterFiveUnfollows ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
      usersPerSearchCycle: storedTimings?.usersPerSearchCycle ?? DEFAULT_USERS_PER_SEARCH_CYCLE,
    };
  });

  // Save timings whenever they change
  useEffect(() => {
    saveTimings(timings);
  }, [timings]);

  useEffect(() => {
    if (
      state.status === "scanning" &&
      !state.isScanningActive &&
      !state.scanIncomplete
    ) {
      saveScanSession({
        page: state.page,
        currentTab: state.currentTab,
        searchTerm: state.searchTerm,
        selectedIds: state.selectedResults.map(user => user.id),
        filter: state.filter,
        scanIncomplete: false,
        timestamp: Date.now(),
      });
      return;
    }
    if (state.status !== "scanning") {
      clearScanSession();
    }
  }, [state]);

  const [cachedScan, setCachedScan] = useState<{ readonly results: readonly UserNode[]; readonly timestamp: number } | null>(() =>
    loadCachedScanResults(),
  );

  const [lang, setLang] = useState<Language>(() => getInitialLanguage());

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    saveLanguage(newLang);
  };


  let isActiveProcess: boolean;
  switch (state.status) {
    case "initial":
      isActiveProcess = false;
      break;
    case "scanning":
      isActiveProcess = Boolean(state.isScanningActive);
      break;
    case "unfollowing":
      isActiveProcess = state.percentage < 100;
      break;
    default:
      assertUnreachable(state);
  }

  const onLoadCached = () => {
    if (!cachedScan || cachedScan.results.length === 0) {
      return;
    }
    const whitelistedResults = loadWhitelist();
    setState({
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 100,
      isScanningActive: false,
      results: cachedScan.results,
      selectedResults: [],
      whitelistedResults,
      filter: {
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    });
    setToast({
      show: true,
      text: t(lang, "loadedFromCache", cachedScan.results.length),
    });
  };

  const onScan = async () => {
    if (state.status !== "initial") {
      return;
    }
    clearScanSession();
    scanningPausedRef.current = false;
    setScanningPaused(false);
    if (isLocalPreview) {
      const previewUsers = _getPreviewUsers();
      setState({
        status: "scanning",
        page: 1,
        searchTerm: "",
        currentTab: "non_whitelisted",
        percentage: 100,
        isScanningActive: false,
        results: previewUsers,
        selectedResults: previewUsers.slice(0, 3),
        whitelistedResults: previewUsers.slice(10, 12),
        filter: {
          showVerified: true,
          showPrivate: true,
          showWithOutProfilePicture: true,
        },
      });
      return;
    }
    const whitelistedResults = loadWhitelist();
    setState({
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 0,
      isScanningActive: true,
      results: [],
      selectedResults: [],
      whitelistedResults,
      filter: {
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    });
  };

  const handleScanFilter = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    const name = e.currentTarget.name;
    const checked = e.currentTarget.checked;
    if (state.selectedResults.length > 0 && !confirm("Changing filter options will clear selected users")) {
      setState(prevState => ({ ...prevState }));
      return;
    }
    setState(prevState => {
      if (prevState.status !== "scanning") {
        return prevState;
      }
      return {
        ...prevState,
        page: 1,
        selectedResults: [],
        filter: {
          ...prevState.filter,
          [name]: checked,
        },
      };
    });
  };

  const handleUnfollowFilter = (e: ChangeEvent<HTMLInputElement>) => {
    const name = e.currentTarget.name;
    const checked = e.currentTarget.checked;
    setState(prevState => {
      if (prevState.status !== "unfollowing") {
        return prevState;
      }
      return {
        ...prevState,
        filter: {
          ...prevState.filter,
          [name]: checked,
        },
      };
    });
  };

  const toggleUser = (newStatus: boolean, user: UserNode) => {
    setState(prevState => {
      if (prevState.status !== "scanning") {
        return prevState;
      }
      if (newStatus) {
        if (prevState.selectedResults.some(result => result.id === user.id)) {
          return prevState;
        }
        return {
          ...prevState,
          selectedResults: [...prevState.selectedResults, user],
        };
      }
      return {
        ...prevState,
        selectedResults: prevState.selectedResults.filter(result => result.id !== user.id),
      };
    });
  };

  const toggleAllUsers = (e: ChangeEvent<HTMLInputElement>) => {
    const checked = e.currentTarget.checked;
    setState(prevState => {
      if (prevState.status !== "scanning") {
        return prevState;
      }
      const displayed = getUsersForDisplay(
        prevState.results,
        prevState.whitelistedResults,
        prevState.currentTab,
        prevState.searchTerm,
        prevState.filter,
      );
      if (checked) {
        const currentIds = new Set(prevState.selectedResults.map(user => user.id));
        const toAdd = displayed.filter(user => !currentIds.has(user.id));
        return {
          ...prevState,
          selectedResults: [...prevState.selectedResults, ...toAdd],
        };
      }
      const displayedIds = new Set(displayed.map(user => user.id));
      return {
        ...prevState,
        selectedResults: prevState.selectedResults.filter(user => !displayedIds.has(user.id)),
      };
    });
  };

  const toggleCurrentePageUsers = (e: ChangeEvent<HTMLInputElement>) => {
    const checked = e.currentTarget.checked;
    setState(prevState => {
      if (prevState.status !== "scanning") {
        return prevState;
      }
      const pageUsers = getCurrentPageUnfollowers(
        getUsersForDisplay(
          prevState.results,
          prevState.whitelistedResults,
          prevState.currentTab,
          prevState.searchTerm,
          prevState.filter,
        ),
        prevState.page,
      );
      if (checked) {
        const currentIds = new Set(prevState.selectedResults.map(user => user.id));
        const toAdd = pageUsers.filter(user => !currentIds.has(user.id));
        return {
          ...prevState,
          selectedResults: [...prevState.selectedResults, ...toAdd],
        };
      }
      const pageUserIds = new Set(pageUsers.map(user => user.id));
      return {
        ...prevState,
        selectedResults: prevState.selectedResults.filter(user => !pageUserIds.has(user.id)),
      };
    });
  };

  const onWhitelistUpdate = (updatedWhitelist: readonly UserNode[]) => {
    saveWhitelist(updatedWhitelist);
    setState(prevState =>
      prevState.status === "scanning"
        ? { ...prevState, whitelistedResults: updatedWhitelist }
        : prevState,
    );
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Prompt user if he tries to leave while in the middle of a process (searching / unfollowing / etc..)
      // This is especially good for avoiding accidental tab closing which would result in a frustrating experience.
      if (!isActiveProcess) {
        return;
      }

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      e = e || window.event;

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // For IE and Firefox prior to version 4
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (e) {
        e.returnValue = "Changes you made may not be saved.";
      }

      // For Safari
      return "Changes you made may not be saved.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActiveProcess, state]);

  useEffect(() => {
    // Neither endpoint exposes a total count up front, so we can't compute an
    // exact percentage. This gives a smooth, ever-increasing estimate based on
    // the number of accounts checked so far, without ever overselling 100%.
    const estimatePhaseProgress = (usersFetchedSoFar: number): number =>
      100 * (1 - 1 / (1 + usersFetchedSoFar / 150));

    // Fetches one page, retrying with backoff on rate limits / network errors.
    // `blocked` is true when retries were exhausted for such a transient error
    // (the scan should stop); false means a different, non-retryable error
    // (e.g. 404 / unavailable account), which callers may choose to skip.
    type PageResult =
      | { readonly ok: true; readonly page: FriendshipsPage }
      | { readonly ok: false; readonly blocked: boolean };

    const fetchPageWithRetry = async (
      kind: "following" | "followers",
      maxId?: string,
      count?: number,
    ): Promise<PageResult> => {
      let retries = 0;
      const maxRetries = 3;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        try {
          return { ok: true, page: await fetchFriendshipsPage(kind, maxId, count) };
        } catch (e: any) {
          const status = e?.status;
          const message = String(e?.message ?? "");
          const isRateLimitOrSoftBlock =
            (e instanceof InstagramApiError || e?.name === "InstagramApiError") &&
            (status === 429 || /feedback_required|checkpoint|rate limit|please wait/i.test(message));
          const isNetworkError = e instanceof TypeError || /fetch|network/i.test(message);
          const isTransient = isRateLimitOrSoftBlock || isNetworkError;

          if (isTransient && retries < maxRetries) {
            retries++;
            const waitSeconds = isRateLimitOrSoftBlock
              ? RATE_LIMIT_COOLDOWN_SECONDS * retries
              : 5 * retries;
            for (let sec = waitSeconds; sec > 0; sec--) {
              setToast({
                show: true,
                text: t(lang, "rateLimitPause", sec),
              });
              await sleep(1000);
            }
            setToast({ show: false });
            continue;
          }
          console.error(`${kind} request failed:`, e);
          return { ok: false, blocked: isTransient };
        }
      }
    };

    let requestsSinceLongSleep = 0;
    const paceRequest = async () => {
      // Pause scanning if user requested so.
      while (scanningPausedRef.current) {
        await sleep(1000);
        console.info("Scan paused");
      }

      await sleep(Math.floor(Math.random() * 700) + 300);
      await sleep(Math.floor(Math.random() * (timings.timeBetweenSearchCycles - timings.timeBetweenSearchCycles * 0.7)) + timings.timeBetweenSearchCycles);

      requestsSinceLongSleep++;
      if (requestsSinceLongSleep >= CHECKS_BEFORE_LONG_SLEEP) {
        requestsSinceLongSleep = 0;
        const longSleepVar = Math.max(
          0,
          timings.timeToWaitAfterFiveSearchCycles + (Math.random() * 10000 - 5000), // +/- 5 seconds
        );
        setToast({
          show: true,
          text: t(lang, "sleepingSafety", Math.round(longSleepVar / 1000)),
        });
        await sleep(longSleepVar);
      }
      setToast({ show: false });
    };

    // Walks the viewer's own following list page by page. `onPageUsers` is
    // awaited for each page before the next one is requested and returns
    // false to stop the walk early. Resolves true only if the whole list was
    // walked.
    const fetchList = async (
      kind: "following" | "followers",
      pageSafetyLimit: number,
      onPageUsers: (pageUsers: readonly RawFriendshipUser[]) => Promise<boolean>,
    ): Promise<boolean> => {
      let maxId: string | undefined;
      let pagesFetched = 0;
      let consecutiveEmptyPages = 0;
      const seenCursors = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const result = await fetchPageWithRetry(kind, maxId, timings.usersPerSearchCycle);
        if (!result.ok) {
          console.error(`Stopping ${kind} scan early.`);
          return false;
        }

        pagesFetched += 1;
        if (pagesFetched > pageSafetyLimit) {
          console.error(`Stopping ${kind} scan early: hit the safety cap of ${pageSafetyLimit} pages.`);
          return false;
        }

        const page = result.page;
        const pageUsers = page.users ?? [];
        if (!(await onPageUsers(pageUsers))) {
          return false;
        }

        if (page.has_more === false) {
          return true;
        }

        const rawNextMaxId = page.next_max_id;
        const nextMaxId =
          rawNextMaxId === undefined || rawNextMaxId === null || String(rawNextMaxId).trim() === ""
            ? undefined
            : String(rawNextMaxId);

        if (nextMaxId === undefined) {
          if (page.has_more === true) {
            console.error(`Stopping ${kind} scan early: Instagram reported more pages without a cursor.`);
            return false;
          }
          return true;
        }

        if (nextMaxId === maxId || seenCursors.has(nextMaxId)) {
          console.error(`Stopping ${kind} scan early: Instagram repeated pagination cursor ${nextMaxId}.`);
          return false;
        }
        seenCursors.add(nextMaxId);

        if (pageUsers.length === 0) {
          consecutiveEmptyPages += 1;
          if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
            console.error(`Stopping ${kind} scan early after ${consecutiveEmptyPages} empty pages.`);
            return false;
          }
        } else {
          consecutiveEmptyPages = 0;
        }

        maxId = nextMaxId;
        await paceRequest();
      }
    };

    const scan = async () => {
      if (state.status !== "scanning" || isLocalPreview) {
        return;
      }
      if (state.percentage === 100) {
        return;
      }

      if (getCookie("ds_user_id") === null) {
        setState(prevState =>
          prevState.status === "scanning" ? { ...prevState, isScanningActive: false } : prevState,
        );
        setToast({ show: true, text: t(lang, "scanFailedFollowing") });
        return;
      }

      // The v1 following payload does not reliably include follows_viewer.
      // Fetch the viewer's follower IDs once, then compute the difference while
      // walking the viewer's following list. This avoids one API request per
      // followed account and eliminates the old "viewer appears first" guess.
      const nonFollowers: UserNode[] = [];
      const followerIds = new Set<string>();
      const processedFollowingIds = new Set<string>();
      let followerCount = 0;
      let checkedCount = 0;

      const followersCompleted = await fetchList(
        "followers",
        FOLLOWING_PAGE_SAFETY_LIMIT,
        async (pageUsers) => {
          for (const user of pageUsers) {
            followerIds.add(String(user.pk_id ?? user.pk));
          }
          followerCount += pageUsers.length;
          setState(prevState =>
            prevState.status === "scanning"
              ? {
                  ...prevState,
                  percentage: Math.min(
                    45,
                    Math.round(estimatePhaseProgress(followerCount) * 0.45),
                  ),
                }
              : prevState,
          );
          return true;
        },
      );

      if (!followersCompleted) {
        setState(prevState =>
          prevState.status === "scanning"
            ? {
                ...prevState,
                percentage: 100,
                scanIncomplete: true,
                isScanningActive: false,
                results: [],
              }
            : prevState,
        );
        setToast({
          show: true,
          text: t(lang, "scanFailedFollowing"),
        });
        return;
      }

      setState(prevState =>
        prevState.status === "scanning"
          ? { ...prevState, percentage: Math.max(prevState.percentage, 45) }
          : prevState,
      );

      const checkPage = async (pageUsers: readonly RawFriendshipUser[]): Promise<boolean> => {
        const pageNonFollowers: UserNode[] = [];
        for (const user of pageUsers) {
          const userId = String(user.pk_id ?? user.pk);
          if (processedFollowingIds.has(userId)) {
            continue;
          }
          processedFollowingIds.add(userId);
          checkedCount += 1;
          if (!followerIds.has(userId)) {
            const node = rawFriendshipUserToUserNode(user, false);
            nonFollowers.push(node);
            pageNonFollowers.push(node);
          }
        }
        setState(prevState => {
          if (prevState.status !== "scanning") {
            return prevState;
          }
          const existingIds = new Set(prevState.results.map(user => user.id));
          const additions = pageNonFollowers.filter(user => !existingIds.has(user.id));
          return {
            ...prevState,
            percentage: Math.min(
              99,
              45 + Math.round(estimatePhaseProgress(checkedCount) * 0.55),
            ),
            results: [...prevState.results, ...additions],
          };
        });
        return true;
      };

      const followingCompleted = await fetchList(
        "following",
        FOLLOWING_PAGE_SAFETY_LIMIT,
        checkPage,
      );

      if (!followingCompleted && checkedCount === 0) {
        setState(prevState =>
          prevState.status === "scanning" ? { ...prevState, isScanningActive: false } : prevState,
        );
        setToast({
          show: true,
          text: t(lang, "scanFailedFollowing"),
        });
        return;
      }

      const scanIsComplete = followersCompleted && followingCompleted;

      // Never overwrite a known-good cache with a partial scan. Older builds
      // could persist interrupted results and later reload them as if complete.
      if (scanIsComplete) {
        saveCachedScanResults(nonFollowers);
        setCachedScan({ results: nonFollowers, timestamp: Date.now() });
      }

      setState(prevState => {
        if (prevState.status !== "scanning") {
          return prevState;
        }
        return {
          ...prevState,
          percentage: 100,
          scanIncomplete: !scanIsComplete,
          isScanningActive: false,
          results: nonFollowers,
        };
      });

      setToast({
        show: true,
        text: scanIsComplete
          ? t(lang, "scanCompleted")
          : t(lang, "partialScanInterrupted", checkedCount),
      });
    };
    scan();
    // Dependency array not entirely legit, but works this way. TODO: Find a way to fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  useEffect(() => {
    const unfollow = async () => {
      if (state.status !== "unfollowing" || isLocalPreview) {
        return;
      }

      const csrftoken = getCookie("csrftoken");
      if (csrftoken === null) {
        throw new Error("csrftoken cookie is null");
      }

      let counter = 0;
      for (const user of state.selectedResults) {
        counter += 1;
        // Fix: Changed from Math.floor to Math.round to ensure progress reaches 100%
        // Math.floor would leave progress at 99% when near completion
        const percentage = Math.round((counter / state.selectedResults.length) * 100);
        try {
          const requestOptions: RequestInit = {
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-csrftoken": csrftoken,
              "x-ig-app-id": INSTAGRAM_WEB_APP_ID,
              "x-asbd-id": INSTAGRAM_ASBD_ID,
              "x-requested-with": "XMLHttpRequest",
            },
            method: "POST",
            credentials: "same-origin",
          };

          const endpoints = [
            unfollowUserUrlGenerator(user.id),
            legacyUnfollowUserUrlGenerator(user.id),
          ];
          let res: Response | null = null;
          let data: any = null;
          let isActionBlocked = false;
          let requestAccepted = false;

          for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
            if (endpointIndex > 0) {
              await sleep(1200);
            }

            res = await fetch(endpoints[endpointIndex], requestOptions);
            data = (await res.json().catch(() => null)) as any;
            const message = String(data?.message ?? "");
            isActionBlocked =
              res.status === 401 ||
              res.status === 403 ||
              res.status === 429 ||
              data?.feedback_required === true ||
              data?.spam === true ||
              data?.require_login === true ||
              /feedback_required|checkpoint_required|checkpoint|challenge_required|action_blocked|login_required|please wait/i.test(
                message,
              );

            requestAccepted =
              res.ok &&
              data !== null &&
              (data?.status === "ok" || data?.friendship_status !== undefined) &&
              !isActionBlocked;

            if (requestAccepted || isActionBlocked) {
              break;
            }
          }

          if (res === null) {
            throw new Error("No unfollow request was attempted");
          }

          const responseConfirmsUnfollow =
            data?.friendship_status?.following === false || data?.following === false;
          const responseSaysStillFollowing =
            data?.friendship_status?.following === true || data?.following === true;

          let success = requestAccepted && !responseSaysStillFollowing;

          // The legacy web route often returns only {status:"ok"}. When the
          // response itself cannot prove the relationship changed, verify it
          // before reporting success to the user.
          if (success && !responseConfirmsUnfollow) {
            try {
              const friendship = await fetchFriendshipStatus(user.id);
              success = friendship.following === false;
            } catch (verificationError: any) {
              console.warn(`Unable to verify unfollow for ${user.username}:`, verificationError);
              const status = verificationError?.status;
              const message = String(verificationError?.message ?? "");
              if (
                status === 401 ||
                status === 403 ||
                status === 429 ||
                /feedback_required|checkpoint|challenge_required|please wait|rate limit/i.test(message)
              ) {
                isActionBlocked = true;
              }
              success = false;
            }
          }
          if (!success) {
            console.warn(`Unfollow for ${user.username} failed (HTTP ${res.status}):`, data);
          }
          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                {
                  user,
                  unfollowedSuccessfully: success,
                },
              ],
            };
          });

          if (isActionBlocked) {
            setToast({
              show: true,
              text: t(lang, "actionBlockedWarning"),
            });
            break;
          }
        } catch (e) {
          console.error(e);
          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                {
                  user,
                  unfollowedSuccessfully: false,
                },
              ],
            };
          });
        }
        // If unfollowing the last user in the list, no reason to wait.
        if (user === state.selectedResults[state.selectedResults.length - 1]) {
          break;
        }
        await sleep(Math.floor(Math.random() * (timings.timeBetweenUnfollows * 1.2 - timings.timeBetweenUnfollows)) + timings.timeBetweenUnfollows);

        if (counter % 5 === 0) {
          setToast({
            show: true,
            text: t(lang, "sleepingSafety", `${Math.round(timings.timeToWaitAfterFiveUnfollows / 60000)}m`),
          });
          await sleep(timings.timeToWaitAfterFiveUnfollows);
        }
        setToast({ show: false });
      }
    };
    unfollow();
    // Dependency array not entirely legit, but works this way. TODO: Find a way to fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  let markup: React.JSX.Element;
  switch (state.status) {
    case "initial":
      markup = <NotSearching onScan={onScan} lang={lang} cachedScan={cachedScan} onLoadCached={onLoadCached}></NotSearching>;
      break;

    case "scanning": {
      markup = <Searching
        state={state}
        handleScanFilter={handleScanFilter}
        toggleUser={toggleUser}
        pauseScan={pauseScan}
        setState={setState}
        scanningPaused={scanningPaused}
        UserCheckIcon={UserCheckIcon}
        UserUncheckIcon={UserUncheckIcon}
        lang={lang}
      ></Searching>;
      break;
    }

    case "unfollowing":
      markup = <Unfollowing
        state={state}
        handleUnfollowFilter={handleUnfollowFilter}
        lang={lang}
      ></Unfollowing>;
      break;

    default:
      assertUnreachable(state);
  }

  const showScanWarning = state.status === "scanning" && state.results.length === 0;

  return (
    <main id="main" role="main" className={`iu ${showScanWarning ? "has-scan-warning" : ""}`}>
      <section className="overlay">
        <Toolbar
          state={state}
          setState={setState}
          isActiveProcess={isActiveProcess}
          toggleAllUsers={toggleAllUsers}
          toggleCurrentePageUsers={toggleCurrentePageUsers}
          setTimings={setTimings}
          currentTimings={timings}
          whitelistedUsers={state.status === "scanning" ? state.whitelistedResults : loadWhitelist()}
          onWhitelistUpdate={onWhitelistUpdate}
          lang={lang}
          onLanguageChange={handleLanguageChange}
        ></Toolbar>

        {markup}

        {toast.show && <Toast show={toast.show} message={toast.text} onClose={() => setToast({ show: false })} />}
      </section>
    </main>
  );
}

if (location.hostname !== INSTAGRAM_HOSTNAME && !isLocalPreview) {
  alert("Can be used only on Instagram routes");
} else {
  document.title = "InstagramUnfollowers";
  document.body.innerHTML = "";
  render(<App />, document.body);
}
