// A domain J7's pilot_synthetic_user_ids() counts as synthetic (the reserved
// test domains, RFC 2606/6761). Nobody can register or receive mail at one,
// so a rehearsal address there is safe to store and useless to email.
// trak.dev is deliberately not accepted (TRAK-89). Shared by the roster
// generator and the loader.
export function isSyntheticDomain(domain) {
  const d = String(domain).trim().toLowerCase();
  return ['example.com', 'example.org', 'example.net'].includes(d)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(example|test|invalid|localhost)$/.test(d);
}

/** True when the address's domain is a synthetic one. */
export const isSyntheticAddress = (email) => isSyntheticDomain(String(email ?? '').split('@').pop());
