import { Router, type IRouter } from "express";
import { GetRecommendationsQueryParams, GetRecommendationsResponse } from "@workspace/api-zod";
import { computeRecommendations } from "../services/recommendation-engine";

const router: IRouter = Router();

router.get("/recommendations", async (req, res): Promise<void> => {
  const query = GetRecommendationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  try {
    const recommendations = await computeRecommendations(query.data.month);
    res.json(GetRecommendationsResponse.parse(recommendations));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid request" });
  }
});

export default router;
