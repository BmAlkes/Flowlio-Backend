import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { getNotifications } from "../controllers/notifications/get-notifications.controller";
import { markAllNotificationsAsRead } from "@/controllers/notifications/mark-all-notifications-read.controller";
import { markNotificationAsRead } from "@/controllers/notifications/mark-notification-read.controller";
import { deleteNotification } from "@/controllers/notifications/delete-notification.controller";
import { deleteAllNotifications } from "@/controllers/notifications/delete-all-notifications.controller";

const router = Router();

router.get("/", isAuthenticated, getNotifications);

router.put("/read-all", isAuthenticated, markAllNotificationsAsRead);

router.put("/:id/read", isAuthenticated, markNotificationAsRead);

router.delete("/delete-all", isAuthenticated, deleteAllNotifications);

router.delete("/:id", isAuthenticated, deleteNotification);

export default router;
