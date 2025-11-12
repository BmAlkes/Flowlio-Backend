import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  createViewerSupportTicket,
  getViewerSupportTickets,
} from "../controllers/support ticket/create-viewer-supportticket.controller";

const router = Router();

// Viewer Support Ticket Routes
router.post("/", isAuthenticated, createViewerSupportTicket);
router.get("/", isAuthenticated, getViewerSupportTickets);

export default router;
