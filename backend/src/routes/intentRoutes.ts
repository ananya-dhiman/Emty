import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  getIntentProfile,
  upsertIntentProfile,
  recordFeedback,
  triggerColdStart,
} from "../controllers/userIntentController";

const router = express.Router();

// GET /api/intent/profile - Fetch current UserIntentProfile
router.get("/profile", verifyToken, getIntentProfile);

// POST /api/intent/profile - Create or update UserIntentProfile (onboarding)
router.post("/profile", verifyToken, upsertIntentProfile);

// PUT /api/intent/feedback - Record thumbs-up or thumbs-down for an email
router.put("/feedback", verifyToken, recordFeedback);

// POST /api/intent/cold-start - Run cold-start extraction at end of sync
router.post("/cold-start", verifyToken, triggerColdStart);

export default router;
