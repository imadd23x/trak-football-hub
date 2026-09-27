// A full reload, so every screen re-reads from the server. Its own module so
// routed tests can observe it (jsdom has no navigation).
export function reloadPage(): void {
  window.location.reload()
}
