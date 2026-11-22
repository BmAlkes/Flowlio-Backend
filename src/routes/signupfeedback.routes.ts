import { Router } from "express";
import { signupFeedback } from "../controllers/super admin/signups/signuprecovery.controller";

// Public one-click answers from signup follow-up emails (signed links). Mounted before CORS: the confirm
// page posts back to itself from the API's own origin.
const router = Router();
router.get("/:id", signupFeedback);
router.post("/:id", signupFeedback);

export default router;
