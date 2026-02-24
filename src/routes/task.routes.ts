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

const router = Router();

router.get("/active-time", isAuthenticated, getActiveTimeEntries);
router.get("/time-entries", isAuthenticated, getAllTimeEntries);
router.delete("/time-entries/:id", isAuthenticated, deleteTimeEntry);

router.post("/create", isAuthenticated, createTask);
router.get("/all", isAuthenticated, getTasks);
router.get("/ongoing", isAuthenticated, getOngoingTasks);

router.get("/:id/subtasks", isAuthenticated, getSubtasksByTaskId);
router.get("/:id", isAuthenticated, getTaskById);
router.put("/update/:id", isAuthenticated, updateTask);
router.patch("/status/:id", isAuthenticated, updateTaskStatus);
router.delete("/:id", isAuthenticated, deleteTask);
router.post("/:id/start", isAuthenticated, startTask);
router.post("/:id/end", isAuthenticated, endTask);

export default router;
