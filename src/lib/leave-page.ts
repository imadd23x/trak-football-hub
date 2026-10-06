/** A full page load to `url`, so the app starts fresh there (tests mock this). */
export const leavePage = (url: string) => window.location.replace(url)
