import { Router } from "express";
import {
  createPayPalOrder,
  capturePayPalOrder,
} from "../controllers/user/payment.controller";

const router = Router();


router.post("/paypal/create-order", createPayPalOrder);

router.post("/paypal/capture-order", capturePayPalOrder);

export default router;
