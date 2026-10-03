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

// TRAK-93: a template address copied from a usage line or a doc, never a real
// inbox. On 29 Sep the TRAK-24 phone file arrived with every address at
// YOURNAME+…@gmail.com. At a real provider such an address is a stranger's
// mailbox, so a roster must never store or email one. Matched on the part
// before any +tag, whole, so youssef@ or yourname-fc@ still pass.
const PLACEHOLDER_LOCAL = new Set([
  'yourname', 'your.name', 'your_name', 'your-name', 'youremail', 'your.email', 'your_email',
  'yourinbox', 'your.inbox', 'you', 'name', 'email', 'inbox', 'user', 'username',
  'firstname', 'lastname', 'firstname.lastname', 'first.last', 'someone',
]);

/** True for a template address such as YOURNAME+x@gmail.com, you@…, <inbox>@…. */
export function isPlaceholderAddress(email) {
  const e = String(email ?? '').trim().toLowerCase();
  if (/[<>{}[\]]/.test(e)) return true;
  return PLACEHOLDER_LOCAL.has(e.split('@')[0].split('+')[0]);
}

/** Never email this: a reserved test address (no mailbox) or a placeholder (a stranger's). */
export const isUnmailableAddress = (email) => isSyntheticAddress(email) || isPlaceholderAddress(email);
