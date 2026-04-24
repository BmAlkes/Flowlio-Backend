import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { createSupportTicket } from "../controllers/support ticket/create-supportticket.controller";
import {
  getSupportTickets,
  getSupportTicketById,
} from "../controllers/support ticket/get-supporttickets.controller";
import { updateSupportTicket } from "../controllers/support ticket/update-supportticket.controller";
import { deleteSupportTicket } from "../controllers/support ticket/delete-supportticket.controller";
import { getAssignmentOptions } from "../controllers/support ticket/get-assignment-options.controller";
import { getSupportTicketMessages } from "../controllers/support ticket/get-ticketmessages.controller";
import { createTicketMessage } from "../controllers/support ticket/create-ticketmessage.controller";
import { clearTicketMessages } from "../controllers/support ticket/clear-ticketmessages.controller";

const router = Router();

// Support Ticket Routes - Separate APIs
router.post("/", isAuthenticated, createSupportTicket);
router.get("/", isAuthenticated, getSupportTickets);

// Assignment options (superadmin and subadmin only) - Must come before /:id route
router.get("/assignment-options", isAuthenticated, getAssignmentOptions);

// Parameterized routes must come after specific routes
router.get("/:id", isAuthenticated, getSupportTicketById);
router.put("/:id", isAuthenticated, updateSupportTicket);
router.delete("/:id", isAuthenticated, deleteSupportTicket);
router.get("/:id/messages", isAuthenticated, getSupportTicketMessages);
router.post("/:id/messages", isAuthenticated, createTicketMessage);
router.delete("/:id/messages", isAuthenticated, clearTicketMessages);

export default router;
