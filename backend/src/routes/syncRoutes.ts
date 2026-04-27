import { Router } from "express";
import { getSyncState, updateSyncState, triggerSync } from "../controllers/syncStateController";

const router = Router();

// Used by Rust sidecar timer
router.get("/state/:accountId", getSyncState);
router.post("/state/:accountId", updateSyncState);
router.post("/trigger", triggerSync);

export default router;
