import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import {
  getOnboarding,
  completeOnboardingStep,
  dismissOnboarding,
  resetOnboarding,
} from "@/controllers/onboarding/onboarding.controller";

const router = Router();

router.get("/", isAuthenticated, getOnboarding);
router.patch("/step", isAuthenticated, completeOnboardingStep);
router.patch("/dismiss", isAuthenticated, dismissOnboarding);
router.patch("/reset", isAuthenticated, resetOnboarding);

export default router;
