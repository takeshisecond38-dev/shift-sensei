import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, unitsTable } from "@workspace/db";
import {
  CreateUnitBody,
  CreateUnitResponse,
  UpdateUnitParams,
  UpdateUnitBody,
  UpdateUnitResponse,
  DeleteUnitParams,
  ListUnitsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/units", async (_req, res): Promise<void> => {
  const units = await db.select().from(unitsTable).orderBy(asc(unitsTable.sortOrder), asc(unitsTable.id));
  res.json(ListUnitsResponse.parse(units));
});

router.post("/units", async (req, res): Promise<void> => {
  const parsed = CreateUnitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const all = await db.select().from(unitsTable);
    sortOrder = all.reduce((max, u) => Math.max(max, u.sortOrder), -1) + 1;
  }

  const [unit] = await db
    .insert(unitsTable)
    .values({ ...parsed.data, sortOrder })
    .returning();

  res.status(201).json(CreateUnitResponse.parse(unit));
});

router.patch("/units/:id", async (req, res): Promise<void> => {
  const params = UpdateUnitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUnitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [unit] = await db
    .update(unitsTable)
    .set(parsed.data)
    .where(eq(unitsTable.id, params.data.id))
    .returning();

  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }

  res.json(UpdateUnitResponse.parse(unit));
});

router.delete("/units/:id", async (req, res): Promise<void> => {
  const params = DeleteUnitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [unit] = await db.delete(unitsTable).where(eq(unitsTable.id, params.data.id)).returning();

  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
