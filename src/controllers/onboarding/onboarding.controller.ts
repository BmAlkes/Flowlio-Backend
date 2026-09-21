import type { RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { createOnboarding, OnboardingError } from "../../modules/onboarding/service";
import { logger } from "../../utils/logger.util";
const service = createOnboarding(connection);
function handler(action: 'read' | 'step' | 'dismiss' | 'reset'): RequestHandler {
  return async (req, res) => {
    if (!req.user) { res.status(401).json({ success: false }); return; }
    if (action === 'step' && (typeof req.body?.step !== 'string' || Object.keys(req.body).some(key => key !== 'step'))) {
      res.status(400).json({ success: false, code: 'INVALID_STEP' }); return;
    }
    try {
      const data = await service.refresh(req.user, action === 'step' ? { step: req.body.step } : action === 'dismiss' ? { dismissed: true } : action === 'reset' ? { dismissed: false } : {});
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof OnboardingError) { res.status(error.status).json({ success: false, code: error.code }); return; }
      logger.error({ error }, 'Onboarding request failed'); res.status(500).json({ success: false, code: 'ONBOARDING_FAILED' });
    }
  };
}
export const getOnboarding = handler('read');
export const completeOnboardingStep = handler('step');
export const dismissOnboarding = handler('dismiss');
export const resetOnboarding = handler('reset');
