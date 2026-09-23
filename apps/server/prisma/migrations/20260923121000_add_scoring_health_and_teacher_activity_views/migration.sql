-- Analytics read path, views 2 and 3. Both read-only.

DROP VIEW IF EXISTS v_scoring_health;

-- Per day and per model version: attempts, completions, failures, retries, and
-- the mean and 95th percentile of queue and scoring latency.
--
-- An attempt counts as a retry when the queue event that immediately preceded
-- it was submission.retry_queued. Counting retry events per day instead would
-- double-count them across model versions on days with more than one.
--
-- Days are bucketed in UTC so the result does not depend on the session
-- time zone.
CREATE VIEW v_scoring_health AS
WITH ai_attempts AS (
  SELECT
    sr.id,
    sr.submission_id,
    sr.status,
    sr.created_at,
    COALESCE(mv.model_name, 'pre_provenance')    AS model_name,
    COALESCE(mv.model_version, 'pre_provenance') AS model_version,
    ((sr.processing_metadata ->> 'elapsed_ms')::numeric / 1000.0) AS scoring_latency_seconds
  FROM scoring_results sr
  LEFT JOIN ai_model_versions mv ON mv.id = sr.model_version_id
  WHERE sr.scorer_type = 'ai'
),
queued_attempts AS (
  SELECT
    att.*,
    q.created_at AS queued_at,
    q.event_type AS queued_event_type,
    EXTRACT(EPOCH FROM (att.created_at - q.created_at))::numeric AS queue_latency_seconds
  FROM ai_attempts att
  LEFT JOIN LATERAL (
    SELECT ae.created_at, ae.event_type
    FROM audit_events ae
    WHERE ae.event_type IN ('submission.queued', 'submission.retry_queued')
      AND ae.entity_id = att.submission_id
      AND ae.created_at <= att.created_at
    ORDER BY ae.created_at DESC
    LIMIT 1
  ) q ON TRUE
)
SELECT
  (qa.created_at AT TIME ZONE 'UTC')::date AS day,
  qa.model_name,
  qa.model_version,
  count(*)::int                                            AS attempts,
  count(*) FILTER (WHERE qa.status = 'completed')::int      AS completions,
  count(*) FILTER (WHERE qa.status = 'failed')::int         AS failures,
  count(*) FILTER (
    WHERE qa.queued_event_type = 'submission.retry_queued'
  )::int                                                   AS retries,
  avg(qa.queue_latency_seconds)                            AS mean_queue_latency_seconds,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY qa.queue_latency_seconds
  )                                                        AS p95_queue_latency_seconds,
  avg(qa.scoring_latency_seconds)                          AS mean_scoring_latency_seconds,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY qa.scoring_latency_seconds
  )                                                        AS p95_scoring_latency_seconds
FROM queued_attempts qa
GROUP BY 1, 2, 3;

DROP VIEW IF EXISTS v_teacher_activity;

-- Per teacher, over every revision they wrote — not only the published ones,
-- which is why this is built from score_revisions and not from
-- v_assessment_outcomes.
--
-- Teachers and admins are listed even with no activity, so an idle account
-- reads as zero rather than as a missing row. Students are never listed.
-- No email is exposed; display_name is kept so the two thesis authors can tell
-- one pilot teacher from another.
CREATE VIEW v_teacher_activity AS
WITH revision_facts AS (
  SELECT
    r.id,
    r.revised_by     AS teacher_id,
    r.submission_id,
    r.base_result_id,
    r.created_at,
    (r.base_result_id IS NOT NULL) AS has_ai_baseline,
    CASE WHEN r.base_result_id IS NULL THEN NULL ELSE (
         (r.final_scores ->> 'task_response')::numeric
           IS DISTINCT FROM (b.scores ->> 'task_response')::numeric
      OR (r.final_scores ->> 'coherence_cohesion')::numeric
           IS DISTINCT FROM (b.scores ->> 'coherence_cohesion')::numeric
      OR (r.final_scores ->> 'lexical_resource')::numeric
           IS DISTINCT FROM (b.scores ->> 'lexical_resource')::numeric
      OR (r.final_scores ->> 'grammatical_range_accuracy')::numeric
           IS DISTINCT FROM (b.scores ->> 'grammatical_range_accuracy')::numeric
      OR (r.final_scores ->> 'overall')::numeric
           IS DISTINCT FROM (b.scores ->> 'overall')::numeric
    ) END AS is_override,
    CASE WHEN r.base_result_id IS NULL THEN NULL ELSE
      abs((r.final_scores ->> 'overall')::numeric - (b.scores ->> 'overall')::numeric)
    END AS abs_delta_overall,
    EXISTS (
      SELECT 1 FROM revision_reason_tags t WHERE t.revision_id = r.id
    ) AS has_reason_tag
  FROM score_revisions r
  LEFT JOIN scoring_results b ON b.id = r.base_result_id
),
timed_revisions AS (
  SELECT
    rf.*,
    EXTRACT(EPOCH FROM (rf.created_at - ro.created_at))::numeric AS review_duration_seconds
  FROM revision_facts rf
  LEFT JOIN LATERAL (
    SELECT ae.created_at
    FROM audit_events ae
    WHERE ae.event_type = 'submission.review_opened'
      AND ae.entity_id  = rf.submission_id
      AND ae.actor_id   = rf.teacher_id
      AND ae.created_at <= rf.created_at
    ORDER BY ae.created_at DESC
    LIMIT 1
  ) ro ON TRUE
),
publishes AS (
  SELECT published_by AS teacher_id, count(*)::int AS publish_count
  FROM published_results
  GROUP BY published_by
),
unpublishes AS (
  SELECT actor_id AS teacher_id, count(*)::int AS unpublish_count
  FROM audit_events
  WHERE event_type = 'result.unpublished' AND actor_id IS NOT NULL
  GROUP BY actor_id
)
SELECT
  u.id                                                AS teacher_id,
  u.display_name,
  count(tr.id)::int                                   AS revision_count,
  count(tr.id) FILTER (WHERE tr.has_ai_baseline)::int AS revisions_with_ai_baseline,
  COALESCE(p.publish_count, 0)                        AS publish_count,
  COALESCE(up.unpublish_count, 0)                     AS unpublish_count,
  (count(tr.id) FILTER (WHERE tr.is_override))::numeric
    / NULLIF(count(tr.id) FILTER (WHERE tr.has_ai_baseline), 0) AS override_rate,
  avg(tr.abs_delta_overall)                           AS mean_abs_delta_overall,
  avg(tr.review_duration_seconds)                     AS mean_review_duration_seconds,
  (count(tr.id) FILTER (WHERE tr.has_reason_tag))::numeric
    / NULLIF(count(tr.id), 0)                         AS reason_tagged_rate
FROM users u
LEFT JOIN timed_revisions tr ON tr.teacher_id = u.id
LEFT JOIN publishes p        ON p.teacher_id = u.id
LEFT JOIN unpublishes up     ON up.teacher_id = u.id
WHERE u.role IN ('teacher', 'admin')
GROUP BY u.id, u.display_name, p.publish_count, up.unpublish_count;
