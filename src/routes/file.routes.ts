import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { uploadVersion } from "../controllers/organization/files/uploadversion.controller";
import { getVersionHistory } from "../controllers/organization/files/getversions.controller";
import { getMedia } from "../controllers/organization/files/getmedia.controller";
import { deleteMedia } from "../controllers/organization/files/deletemedia.controller";
import { uploadEditorImage } from "../controllers/organization/files/editorupload.controller";
import { upload } from "../controllers/ai/aiAssistant.controller";

const router = Router();

/**
 * @route   POST /api/attachments/:id/versions
 * @desc    Upload a new version of an attachment
 * @access  Private (Authenticated)
 */
router.post(
  "/attachments/:id/versions",
  isAuthenticated,
  upload.single("file"),
  uploadVersion as any,
);

/**
 * @route   GET /api/attachments/:id/versions
 * @desc    Fetch version history for an attachment
 * @access  Private (Authenticated)
 */
router.get(
  "/attachments/:id/versions",
  isAuthenticated,
  getVersionHistory as any,
);

/**
 * @route   GET /api/media
 * @desc    Get all media for the organization (Client Media Center)
 * @access  Private (Authenticated)
 */
router.get("/media", isAuthenticated, getMedia as any);

/**
 * @route   DELETE /api/media/:fileId
 * @desc    Delete a media file (Client Media Center)
 * @access  Private (Authenticated)
 */
router.delete("/media/:fileId", isAuthenticated, deleteMedia as any);

/**
 * @route   GET /api/clients/:clientId/media
 * @desc    Get all media for a specific client
 * @access  Private (Authenticated)
 */
router.get("/clients/:clientId/media", isAuthenticated, getMedia as any);

/**
 * @route   POST /api/editor/upload
 * @desc    Upload an image for the rich text editor
 * @access  Private (Authenticated)
 */
router.post(
  "/editor/upload",
  isAuthenticated,
  upload.single("image"), // Use 'image' as the field name
  uploadEditorImage as any,
);

export default router;
