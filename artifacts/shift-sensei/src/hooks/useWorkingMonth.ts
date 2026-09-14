import { useEffect, useState } from 'react';
import { parse, format } from 'date-fns';

/**
 * Shared hook that reads and writes the "month the manager is currently
 * working on" from/to localStorage.
 *
 * Key: 'shift-sensei:currentMonth' (yyyy-MM)
 *
 * All pages that need to know the active working month — the shift grid,
 * month-end check, AI相談, export — should use this hook so they stay in
 * sync automatically.  The shift grid is the primary writer; other pages
 * are typically read-only consumers.
 */
export const CURRENT_MONTH_STORAGE_KEY = 'shift-sensei:currentMonth';

function loadStoredMonth(): Date {
  try {
    const stored = localStorage.getItem(CURRENT_MONTH_STORAGE_KEY);
    if (stored) {
      const parsed = parse(stored, 'yyyy-MM', new Date());
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  } catch {
    // localStorage unavailable (e.g. private mode) — fall back to today.
  }
  return new Date();
}

/**
 * Returns [currentMonth: Date, setCurrentMonth, monthStr: string].
 * Pass `readonly = true` to skip the localStorage write-back effect
 * (useful in consumer pages that only need to read the month).
 */
export function useWorkingMonth(readonly = false): [Date, React.Dispatch<React.SetStateAction<Date>>, string] {
  const [currentMonth, setCurrentMonth] = useState<Date>(loadStoredMonth);
  const monthStr = format(currentMonth, 'yyyy-MM');

  useEffect(() => {
    if (readonly) return;
    try {
      localStorage.setItem(CURRENT_MONTH_STORAGE_KEY, monthStr);
    } catch {
      // Ignore write failures — persistence is a nice-to-have.
    }
  }, [monthStr, readonly]);

  return [currentMonth, setCurrentMonth, monthStr];
}
