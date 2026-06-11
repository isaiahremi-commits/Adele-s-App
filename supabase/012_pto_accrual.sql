-- =========================================================================
-- Migration 012 — PTO Accrual Engine. Run in the Supabase SQL editor. Idempotent.
--
-- Accrues PTO from REGULAR hours only (OT/training/PTO/holiday never accrue),
-- using tenure-bracketed rates off date_of_hire. Runs whenever a timecard
-- enters/stays in an accruing state (approved/posted) — wired via an
-- exception-safe AFTER trigger on `timecards` so it covers every path
-- (tc_approve, tc_override re-save, tc_set_status, post) without re-creating
-- the timecard engine RPCs, and never blocks a timecard write on an accrual
-- edge case. Idempotent: re-running replaces the timecard's accrual row.
--
-- RLS is live (004b); all functions are SECURITY DEFINER so they write
-- pto_balance_transactions / pto_balances as owner.
-- =========================================================================

-- Recompute a balance from the full ledger (avoids incremental drift).
CREATE OR REPLACE FUNCTION pto_recompute_balance(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sum numeric;
BEGIN
  SELECT coalesce(sum(delta_hours), 0) INTO v_sum
    FROM pto_balance_transactions WHERE employee_id = p_employee_id;
  INSERT INTO pto_balances (employee_id, balance_hours, updated_at)
  VALUES (p_employee_id, round(v_sum, 2), now())
  ON CONFLICT (employee_id) DO UPDATE SET balance_hours = round(v_sum, 2), updated_at = now();
END;
$$;

-- Accrue (or clean up) for a single timecard. Idempotent per timecard_id.
CREATE OR REPLACE FUNCTION pto_accrue_for_timecard(p_timecard_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tc      timecards%rowtype;
  v_hire    date;
  v_term    date;
  v_tenure  int;
  v_rate    numeric;
  v_accrued numeric;
BEGIN
  SELECT * INTO v_tc FROM timecards WHERE id = p_timecard_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Always start by clearing any prior accrual for this timecard (idempotent).
  DELETE FROM pto_balance_transactions
   WHERE transaction_type = 'accrual' AND reference_id = p_timecard_id;

  -- Only approved/posted timecards accrue. (Anything else = cleanup-only.)
  IF v_tc.status NOT IN ('approved', 'posted') THEN
    PERFORM pto_recompute_balance(v_tc.employee_id);
    RETURN;
  END IF;

  SELECT date_of_hire, termination_date INTO v_hire, v_term
    FROM employees WHERE id = v_tc.employee_id;

  -- No hire date -> skip silently (UI surfaces "accrual paused"). After
  -- termination -> no accrual. Either way, recompute and stop.
  IF v_hire IS NULL
     OR (v_term IS NOT NULL AND v_tc.date > v_term) THEN
    PERFORM pto_recompute_balance(v_tc.employee_id);
    RETURN;
  END IF;

  v_tenure := v_tc.date - v_hire;
  IF    v_tenure < 183  THEN v_rate := 0.04393;   -- < ~6 months
  ELSIF v_tenure < 1826 THEN v_rate := 0.08786;   -- < ~5 years
  ELSE                       v_rate := 0.11111;   -- 5+ years
  END IF;

  v_accrued := round(coalesce(v_tc.regular_hours, 0) * v_rate, 4);

  INSERT INTO pto_balance_transactions (employee_id, delta_hours, transaction_type, reference_id, notes)
  VALUES (v_tc.employee_id, v_accrued, 'accrual', p_timecard_id,
          format('Auto-accrual for %s (%sh × %s)', v_tc.date, coalesce(v_tc.regular_hours, 0), v_rate));

  PERFORM pto_recompute_balance(v_tc.employee_id);
END;
$$;

-- Trigger: fire accrual whenever status or regular_hours changes (or on insert).
-- Exception-safe so a timecard approval/edit never fails on an accrual error.
CREATE OR REPLACE FUNCTION trg_pto_accrue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.regular_hours IS DISTINCT FROM OLD.regular_hours THEN
    BEGIN
      PERFORM pto_accrue_for_timecard(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pto_accrue_for_timecard failed for timecard %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pto_accrue_after_timecard ON timecards;
CREATE TRIGGER pto_accrue_after_timecard
  AFTER INSERT OR UPDATE ON timecards
  FOR EACH ROW EXECUTE FUNCTION trg_pto_accrue();

NOTIFY pgrst, 'reload schema';
