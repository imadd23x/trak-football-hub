const AUTH_REQUEST_TIMEOUT_MS = 20_000;
// Failed refreshes retain their first account through SDK backoff, including
// throttled background tabs. Successful responses release the entry.

/** Bound persistent Auth requests before the SDK can consume/save their result. */
export function createAuthFetch(
  projectUrl: string,
  storage: Pick<Storage, 'getItem'>,
  storageKey: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  const authUrl = new URL(`${projectUrl.replace(/\/$/, '')}/auth/v1/`);
  const refreshAttempts = new Map<string, { identity: string | null }>();
  const identity = (): string | null => {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) ?? 'null') as { user?: { id?: unknown }; refresh_token?: unknown } | null;
      // The same user can have a newer session. A late SDK response must not
      // restore or remove the replaced credential, even when the user ID matches.
      return typeof saved?.user?.id === 'string'
        ? JSON.stringify([saved.user.id, typeof saved.refresh_token === 'string' ? saved.refresh_token : null]) : null;
    } catch { return null; }
  };

  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== authUrl.origin || !url.pathname.startsWith(authUrl.pathname)) return fetcher(input, init);
    let refreshToken: string | undefined;
    if (url.pathname === `${authUrl.pathname}token` && url.searchParams.get('grant_type') === 'refresh_token' && typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body) as { refresh_token?: unknown };
        if (typeof body.refresh_token === 'string') refreshToken = body.refresh_token;
      } catch { /* Let the server classify a malformed body. */ }
    }
    const changed = () => new Error('Your account changed. Please try again.');
    let refreshAttempt = refreshToken ? refreshAttempts.get(refreshToken) : undefined;
    if (refreshToken && !refreshAttempt) {
      refreshAttempt = { identity: identity() };
      refreshAttempts.set(refreshToken, refreshAttempt);
    }
    // A retry belongs to its first account, including the backoff gap when no
    // HTTP request is active to observe a cross-tab storage event.
    const startedFor = refreshAttempt ? refreshAttempt.identity : identity();
    if (identity() !== startedFor) throw changed();
    const controller = new AbortController();
    const outer = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let rejectCancelled!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const onAbort = () => rejectCancelled(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const cancelOuter = () => controller.abort(outer?.reason);
    outer?.addEventListener('abort', cancelOuter, { once: true });
    if (outer?.aborted) cancelOuter();
    const checkAccount = () => {
      if (identity() !== startedFor) {
        controller.abort(changed());
      }
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        try { checkAccount(); } catch { /* The request race owns the rejection. */ }
      }
    };
    window.addEventListener('storage', onStorage);
    const timer = setTimeout(() => controller.abort(new Error('The account request took too long. Check your connection and try again.')), AUTH_REQUEST_TIMEOUT_MS);
    try {
      return await Promise.race([cancelled, (async () => {
        checkAccount();
        const response = await fetcher(input, { ...init, signal: controller.signal });
        checkAccount();
        // fetch resolves at headers. Consume the body within the same deadline
        // so a late body cannot deliver a session after the UI reports failure.
        const body = await response.arrayBuffer();
        checkAccount();
        if (refreshToken && response.ok) {
          try {
            const result = JSON.parse(new TextDecoder().decode(body)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user?: { id?: unknown } };
            // A complete session response ends the SDK's refresh retry. Drop
            // only successful attempts; elapsed time cannot prove a throttled
            // background retry is finished. This also preserves deliberate
            // account adoption and the server's refresh-token reuse window.
            if (typeof result.access_token === 'string' && typeof result.refresh_token === 'string' && typeof result.expires_in === 'number' && typeof result.user?.id === 'string') {
              refreshAttempts.delete(refreshToken);
            }
          } catch { /* Preserve SDK classification of malformed JSON. */ }
        }
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      })()]);
    } finally {
      clearTimeout(timer); window.removeEventListener('storage', onStorage);
      outer?.removeEventListener('abort', cancelOuter);
      controller.signal.removeEventListener('abort', onAbort);
    }
  };
}
