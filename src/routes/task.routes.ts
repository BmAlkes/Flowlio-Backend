import { validateListQuery } from "../utils/list-query";
import { resourceAccess } from "../security/resource-access";
import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { createTask } from "../controllers/organization/tasks/createtask.controller";
import {
  getTasks,
  getTaskById,
  getSubtasksByTaskId,
} from "../controllers/organization/tasks/gettasks.controller";
import {
  updateTask,
  updateTaskStatus,
} from "../controllers/organization/tasks/updatetask.controller";
import { deleteTask } from "../controllers/organization/tasks/deletetask.controller";
import { getOngoingTasks } from "../controllers/organization/tasks/getongoingtasks.controller";
// Import time tracking controllers
import { startTask } from "../controllers/organization/tasks/starttask.controller";
import { endTask } from "../controllers/organization/tasks/endtask.controller";
import { getActiveTimeEntries } from "../controllers/organization/tasks/getactivetimeentries.controller";
import { getAllTimeEntries } from "../controllers/organization/tasks/getalltimeentries.controller";
import { deleteTimeEntry } from "../controllers/organization/tasks/deletetimeentry.controller";
import { getTasksByClient } from "../controllers/organization/tasks/gettasksbyclient.controller";

const router = Router();

router.get("/active-time", isAuthenticated, getActiveTimeEntries);
router.get("/time-entries", isAuthenticated, validateListQuery, getAllTimeEntries);
router.delete("/time-entries/:id", isAuthenticated, deleteTimeEntry);

router.post("/create", isAuthenticated, resourceAccess.action("create"), resourceAccess.project(req => req.body.projectId, "create"), resourceAccess.taskReferences, createTask);
router.get("/all", isAuthenticated, validateListQuery, getTasks);
router.get("/ongoing", isAuthenticated, getOngoingTasks);
router.post("/client/:clientId", isAuthenticated, resourceAccess.client(req => req.params.clientId), getTasksByClient);

router.get("/:id/subtasks", isAuthenticated, resourceAccess.task(req => req.params.id), getSubtasksByTaskId);
router.get("/:id", isAuthenticated, resourceAccess.task(req => req.params.id), getTaskById);
router.put("/update/:id", isAuthenticated, resourceAccess.task(req => req.params.id, "update"), resourceAccess.taskReferences, updateTask);
router.patch("/status/:id", isAuthenticated, resourceAccess.task(req => req.params.id, "update"), updateTaskStatus);
router.delete("/:id", isAuthenticated, resourceAccess.task(req => req.params.id, "delete"), deleteTask);
router.post("/:id/start", isAuthenticated, resourceAccess.task(req => req.params.id, "track"), startTask);
router.post("/:id/end", isAuthenticated, resourceAccess.task(req => req.params.id, "track"), endTask);

export default router;
