import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import shiftsRouter from "./shifts";
import shiftTypesRouter from "./shift-types";
import summaryRouter from "./summary";
import scheduleSettingsRouter from "./schedule-settings";
import unitsRouter from "./units";
import nightDutyOwnershipRouter from "./night-duty-ownership";
import aiConsultRouter from "./ai-consult";
import recommendationsRouter from "./recommendations";
import facilityRulesRouter from "./facility-rules";
import dayRemarksRouter from "./day-remarks";
import dayStaffingStatusRouter from "./day-staffing-status";
import dataManagementRouter from "./data-management";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(healthRouter);
router.use(authRouter);

// All routes below require authentication in production
router.use(requireAuth);
router.use(staffRouter);
router.use(shiftsRouter);
router.use(shiftTypesRouter);
router.use(summaryRouter);
router.use(scheduleSettingsRouter);
router.use(unitsRouter);
router.use(nightDutyOwnershipRouter);
router.use(aiConsultRouter);
router.use(recommendationsRouter);
router.use(facilityRulesRouter);
router.use(dayRemarksRouter);
router.use(dayStaffingStatusRouter);
router.use(dataManagementRouter);

export default router;
