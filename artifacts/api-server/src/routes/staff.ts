import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, staffTable } from "@workspace/db";
import {
  CreateStaffBody,
  CreateStaffResponse,
  UpdateStaffParams,
  UpdateStaffBody,
  UpdateStaffResponse,
  DeleteStaffParams,
  ListStaffResponse,
  ReorderStaffBody,
  ReorderStaffResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/staff", async (_req, res): Promise<void> => {
  const staff = await db
    .select()
    .from(staffTable)
    .orderBy(asc(staffTable.sortOrder), asc(staffTable.id));
  res.json(ListStaffResponse.parse(staff));
});

router.post("/staff", async (req, res): Promise<void> => {
  const parsed = CreateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const all = await db.select().from(staffTable);
    sortOrder = all.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
  }

  const [staff] = await db
    .insert(staffTable)
    .values({ ...parsed.data, sortOrder })
    .returning();

  res.status(201).json(CreateStaffResponse.parse(staff));
});

router.post("/staff/reorder", async (req, res): Promise<void> => {
  const parsed = ReorderStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(staffTable)
    .where(inArray(staffTable.id, parsed.data.ids));
  if (existing.length !== parsed.data.ids.length) {
    res.status(400).json({ error: "One or more staff ids do not exist" });
    return;
  }

  await Promise.all(
    parsed.data.ids.map((id, index) =>
      db.update(staffTable).set({ sortOrder: index }).where(eq(staffTable.id, id)),
    ),
  );

  const staff = await db
    .select()
    .from(staffTable)
    .orderBy(asc(staffTable.sortOrder), asc(staffTable.id));
  res.json(ReorderStaffResponse.parse(staff));
});

router.patch("/staff/:id", async (req, res): Promise<void> => {
  const params = UpdateStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [staff] = await db
    .update(staffTable)
    .set(parsed.data)
    .where(eq(staffTable.id, params.data.id))
    .returning();

  if (!staff) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }

  res.json(UpdateStaffResponse.parse(staff));
});

router.delete("/staff/:id", async (req, res): Promise<void> => {
  const params = DeleteStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [staff] = await db
    .delete(staffTable)
    .where(eq(staffTable.id, params.data.id))
    .returning();

  if (!staff) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
