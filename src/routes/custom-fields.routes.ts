import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  createCustomFieldDefinition,
  getCustomFieldDefinitions,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
} from "../controllers/organization/custom-fields.controller";

const router = Router();

router.post("/", isAuthenticated, createCustomFieldDefinition);
router.get("/", isAuthenticated, getCustomFieldDefinitions);
router.put("/:id", isAuthenticated, updateCustomFieldDefinition);
router.delete("/:id", isAuthenticated, deleteCustomFieldDefinition);

export default router;
