# Consent helper compatibility handoff

Apply `pr-94-scoped-consent-rpc.patch` to PR #94 head
`687766f89c8721cc0a6d9721a9dfcb82ba8ddf3f` and
`pr-95-scoped-consent-rpc.patch` to PR #95 head
`a0982dad7539b62393663e52468c6c004bf02f96` after confirming those heads remain current.

Both depend on migration
`20260921182442_restrict_consent_helper_rpc_access.sql`, which adds
`coach_squad_player_consent_required(p_squad_player_id uuid) -> boolean`.
Unauthorized rows return SQLSTATE42501, including missing/null IDs. Only the
owning current authenticated coach can call it; service callers keep the
internal helpers. The private RLS bridge is separate from this public endpoint.

#94 changes four RPC names, the MSW path, and a comment. #95 changes two coach
calls and its player's self-age lookup to `my_consent_status()`. No arguments,
return contracts, UI flows, or assertion counts change.

Validated in a disposable combined checkout: #94 eight UI tests pass; #95
19-assertion SQL journey passes after all 84 migrations. Both patch reverse
checks pass. Other authors' branches have not been edited or pushed.

Logs: `/private/tmp/trak-helper-compat-ui.log`,
`/private/tmp/trak-helper-compat-journey.log`.
These are local results, not hosted deployment evidence.
