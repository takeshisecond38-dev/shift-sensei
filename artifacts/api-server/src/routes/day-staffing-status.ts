import { Router, type IRouter } from "express";
import { computeDailyStaffingSeverity } from "../services/facility-rule-engine";
import { ListDayStaffingStatusQueryParams, ListDayStaffingStatusResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/day-staffing-status", async (req, res): Promise<void> => {
  const query = ListDayStaffingStatusQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(query.data.month)) {
    res.status(400).json({ error: "month must be in YYYY-MM format" });
    return;
  }

  const severityByDate = await computeDailyStaffingSeverity(query.data.month);
  const result = Array.from(severityByDate.entries()).map(([date, severity]) => ({ date, severity }));

  res.json(ListDayStaffingStatusResponse.parse(result));
});

export default router;
