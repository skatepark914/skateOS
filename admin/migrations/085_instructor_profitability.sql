-- ============================================================
-- 085_instructor_profitability.sql
--
-- View that joins lesson revenue + instructor payroll into a
-- per-instructor P&L. Powers the Reports card. Refreshes
-- automatically every time the daily Square cron pulls new
-- shifts + bookings.
-- ============================================================

CREATE OR REPLACE VIEW public.instructor_profitability AS
WITH lesson_rev AS (
  SELECT
    instructor,
    COUNT(*) AS lesson_count,
    COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > NOW()) AS upcoming_count,
    COUNT(*) FILTER (WHERE status IN ('cancelled', 'no_show')) AS cancelled_count,
    SUM(COALESCE(price, 0)) AS revenue,
    AVG(NULLIF(price, 0)) AS avg_lesson_price,
    MIN(scheduled_at) AS first_lesson,
    MAX(scheduled_at) AS last_lesson
  FROM lessons
  WHERE instructor IS NOT NULL
  GROUP BY instructor
),
inst_cost AS (
  SELECT
    s.display_name AS instructor,
    SUM(te.hours) AS hours,
    SUM(te.hours * te.wage_at_clock_in) AS payroll_cost,
    AVG(NULLIF(te.wage_at_clock_in, 0)) AS avg_rate
  FROM time_entries te
  JOIN staff s ON te.staff_id = s.id
  WHERE te.imported_from = 'square_payroll'
    AND lower(te.wage_job_title) LIKE '%instructor%'
  GROUP BY s.display_name
)
SELECT
  COALESCE(lr.instructor, ic.instructor) AS instructor,
  COALESCE(lr.lesson_count, 0)   AS lessons,
  COALESCE(lr.upcoming_count, 0) AS upcoming,
  COALESCE(lr.cancelled_count, 0) AS cancelled,
  COALESCE(lr.revenue, 0)        AS revenue,
  COALESCE(lr.avg_lesson_price, 0) AS avg_lesson_price,
  COALESCE(ic.hours, 0)          AS instructor_hours,
  COALESCE(ic.payroll_cost, 0)   AS payroll_cost,
  COALESCE(ic.avg_rate, 0)       AS avg_hourly_rate,
  COALESCE(lr.revenue, 0) - COALESCE(ic.payroll_cost, 0) AS margin,
  CASE WHEN COALESCE(ic.payroll_cost, 0) > 0
    THEN ROUND((COALESCE(lr.revenue, 0) / ic.payroll_cost * 100)::numeric, 0)
    ELSE NULL END AS roi_pct,
  lr.first_lesson,
  lr.last_lesson
FROM lesson_rev lr
FULL OUTER JOIN inst_cost ic ON lr.instructor = ic.instructor;

GRANT SELECT ON public.instructor_profitability TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '085 applied: instructor_profitability view';
END $$;
