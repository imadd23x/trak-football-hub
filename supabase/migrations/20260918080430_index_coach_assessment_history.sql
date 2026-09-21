-- Coach Home filters assessments by coach and orders by date for its latest
-- five feed. Separate coach-ID and squad/date indexes require a history scan
-- and sort for that query. Retain them for their other access patterns.
-- This adds no privileges and changes no RLS or query/history scope. Existing
-- queries have no secondary sort key, so timestamp-tie order stays unspecified.
-- Normal CREATE INDEX blocks writes during its build; review the target size
-- and release window. Local synthetic timings are not a production guarantee.
CREATE INDEX idx_coach_assessments_coach_created
  ON public.coach_assessments (coach_user_id, created_at DESC);
