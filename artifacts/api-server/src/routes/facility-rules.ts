import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, facilityRulesTable } from "@workspace/db";
import {
  ListFacilityRulesResponse,
  CreateFacilityRuleBody,
  CreateFacilityRuleResponse,
  UpdateFacilityRuleParams,
  UpdateFacilityRuleBody,
  UpdateFacilityRuleResponse,
  DeleteFacilityRuleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/facility-rules", async (req, res): Promise<void> => {
  const unitIdRaw = req.query["unitId"];
  const unitId = typeof unitIdRaw === "string" ? Number(unitIdRaw) : undefined;

  const rules = await db
    .select()
    .from(facilityRulesTable)
    .where(unitId !== undefined && !Number.isNaN(unitId) ? eq(facilityRulesTable.unitId, unitId) : undefined)
    .orderBy(asc(facilityRulesTable.sortOrder), asc(facilityRulesTable.id));

  res.json(ListFacilityRulesResponse.parse(rules));
});

router.post("/facility-rules", async (req, res): Promise<void> => {
  const parsed = CreateFacilityRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const all = await db.select().from(facilityRulesTable);
    sortOrder = all.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
  }

  const [rule] = await db
    .insert(facilityRulesTable)
    .values({ ...parsed.data, sortOrder })
    .returning();

  res.status(201).json(CreateFacilityRuleResponse.parse(rule));
});

router.patch("/facility-rules/:id", async (req, res): Promise<void> => {
  const params = UpdateFacilityRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFacilityRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [rule] = await db
    .update(facilityRulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(facilityRulesTable.id, params.data.id))
    .returning();

  if (!rule) {
    res.status(404).json({ error: "Facility rule not found" });
    return;
  }

  res.json(UpdateFacilityRuleResponse.parse(rule));
});

router.delete("/facility-rules/:id", async (req, res): Promise<void> => {
  const params = DeleteFacilityRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [rule] = await db
    .delete(facilityRulesTable)
    .where(eq(facilityRulesTable.id, params.data.id))
    .returning();

  if (!rule) {
    res.status(404).json({ error: "Facility rule not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
