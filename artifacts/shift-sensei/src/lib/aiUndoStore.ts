/**
 * Tiny cross-page undo bridge for AI plan executions.
 *
 * Flow:
 *   1. ai-consult captures the current shift list as "before" via storeBefore().
 *   2. The AI plan is executed (POST .../execute).
 *   3. The user navigates back to the shifts page.
 *   4. shifts/index.tsx calls consumePending() on mount, diffs the stored
 *      "before" against the freshly loaded shifts ("after"), and pushes one
 *      undo entry onto its local undo stack.
 *
 * sessionStorage is used so the snapshot survives client-side navigation
 * within the same tab but is discarded if the tab is closed.
 */

import type { Shift } from "@workspace/api-client-react";

const STORAGE_KEY = "ai-undo-pending";

interface PendingSnapshot {
  month: string;
  before: Shift[];
}

export const aiUndoStore = {
  /** Call this BEFORE executing an AI plan. */
  storeBefore(month: string, before: Shift[]): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ month, before }));
    } catch {
      // sessionStorage unavailable (private browsing quota exceeded) — ignore
    }
  },

  /**
   * Call this on shifts page mount.
   * Returns and removes the stored snapshot, or null if none exists.
   */
  consumePending(): PendingSnapshot | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(STORAGE_KEY);
      return JSON.parse(raw) as PendingSnapshot;
    } catch {
      return null;
    }
  },
};
