import { Router } from "express";
import { getSyncState, getSyncStateActive, updateSyncState, triggerSync, setActiveAccount } from "../controllers/syncStateController";

const router = Router();

// Used by Rust sidecar timer to find the persistent active account
router.get("/state/active", getSyncStateActive);
router.post("/active", setActiveAccount);

// Used by Rust sidecar timer with explicit account ID
router.get("/state/:accountId", getSyncState);
router.post("/state/:accountId", updateSyncState);
router.post("/trigger", triggerSync);

export default router;
