import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, shiftTypesTable } from "@workspace/db";
import {
  CreateShiftTypeBody,
  CreateShiftTypeResponse,
  UpdateShiftTypeParams,
  UpdateShiftTypeBody,
  UpdateShiftTypeResponse,
  DeleteShiftTypeParams,
  ListShiftTypesResponse,
  ReorderShiftTypesBody,
  ReorderShiftTypesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/shift-types", async (_req, res): Promise<void> => {
  const shiftTypes = await db
    .select()
    .from(shiftTypesTable)
    .orderBy(asc(shiftTypesTable.sortOrder), asc(shiftTypesTable.id));
  res.json(ListShiftTypesResponse.parse(shiftTypes));
});

router.post("/shift-types", async (req, res): Promise<void> => {
  const parsed = CreateShiftTypeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.code, parsed.data.code));
  if (existing) {
    res.status(409).json({ error: `Shift type code "${parsed.data.code}" already exists` });
    return;
  }

  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const all = await db.select().from(shiftTypesTable);
    sortOrder = all.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
  }

  const [shiftType] = await db
    .insert(shiftTypesTable)
    .values({ ...parsed.data, sortOrder })
    .returning();

  res.status(201).json(CreateShiftTypeResponse.parse(shiftType));
});

router.post("/shift-types/reorder", async (req, res): Promise<void> => {
  const parsed = ReorderShiftTypesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(shiftTypesTable)
    .where(inArray(shiftTypesTable.id, parsed.data.ids));
  if (existing.length !== parsed.data.ids.length) {
    res.status(400).json({ error: "One or more shift type ids do not exist" });
    return;
  }

  await Promise.all(
    parsed.data.ids.map((id, index) =>
      db.update(shiftTypesTable).set({ sortOrder: index }).where(eq(shiftTypesTable.id, id)),
    ),
  );

  const shiftTypes = await db
    .select()
    .from(shiftTypesTable)
    .orderBy(asc(shiftTypesTable.sortOrder), asc(shiftTypesTable.id));
  res.json(ReorderShiftTypesResponse.parse(shiftTypes));
});

router.patch("/shift-types/:id", async (req, res): Promise<void> => {
  const params = UpdateShiftTypeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateShiftTypeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.code !== undefined) {
    const [codeOwner] = await db
      .select()
      .from(shiftTypesTable)
      .where(eq(shiftTypesTable.code, parsed.data.code));
    if (codeOwner && codeOwner.id !== params.data.id) {
      res.status(409).json({ error: `Shift type code "${parsed.data.code}" already exists` });
      return;
    }
  }

  const [shiftType] = await db
    .update(shiftTypesTable)
    .set(parsed.data)
    .where(eq(shiftTypesTable.id, params.data.id))
    .returning();

  if (!shiftType) {
    res.status(404).json({ error: "Shift type not found" });
    return;
  }

  res.json(UpdateShiftTypeResponse.parse(shiftType));
});

router.delete("/shift-types/:id", async (req, res): Promise<void> => {
  const params = DeleteShiftTypeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [shiftType] = await db
    .delete(shiftTypesTable)
    .where(eq(shiftTypesTable.id, params.data.id))
    .returning();

  if (!shiftType) {
    res.status(404).json({ error: "Shift type not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
