import { Router } from "express";
import {
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
} from "../controllers/user/newsletter.controller";

const router = Router();

router.post("/subscribe", subscribeToNewsletter);

router.post("/unsubscribe", unsubscribeFromNewsletter);

export default router;
