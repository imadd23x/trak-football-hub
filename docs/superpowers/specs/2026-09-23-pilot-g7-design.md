# Pilot G7: disable deferred processing and media

Implements the approved first-pilot scope in `MVP Requirements`, guarantee G7.

The pilot serves coach-written assessments and messages. AI generation, the
assistant, schedule parsing, passport sharing, and profile photos are unavailable.
Account data access/export and deletion remain available.

## Boundaries

- Deferred AI and passport routes render a static, role-guarded coming-soon page.
- Each AI edge entry point refuses requests before parsing child content, reading
  records, charging quota, or making provider requests. OPTIONS remains usable.
- Profile pages and settings do not upload or render photos. Initials remain.
- New database policies close avatar list/read/sign/upload/replacement for public
  application roles, without disabling unrelated buckets or trusted cleanup.
- Existing storage objects are retained for an explicitly reviewed cleanup. RLS
  cannot revoke an already-issued signed URL; release evidence must account for
  its remaining lifetime. No live storage deletion is part of this change.
- Manual coach publication, password recovery, account export and account
  deletion must retain their existing behavior.

## Verification

Use failing tests before implementation: routed placeholders and role controls,
AI handlers with provider/data access traps, profile upload controls, and SQL
negative tests with unrelated-bucket and cleanup controls. Run the required
source, harness, type, build, lint, use-case and database checks. Record local
proof separately from deployment evidence; this does not certify G7 on live.
