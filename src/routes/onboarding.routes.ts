import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import {
  getOnboarding,
  completeOnboardingStep,
  dismissOnboarding,
} from "@/controllers/onboarding/onboarding.controller";

const router = Router();

router.get("/", isAuthenticated, getOnboarding);
router.patch("/step", isAuthenticated, completeOnboardingStep);
router.patch("/dismiss", isAuthenticated, dismissOnboarding);

export default router;
