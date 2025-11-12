import { getCurrentUserProfile } from "@/controllers/user/profile.controller";
import { updateProfileImage } from "@/controllers/user/updateprofileimage.controller";
import { updateUserProfile as updateUserProfileController } from "@/controllers/user/updateuserprofile.controller";
import { patchUserProfile } from "@/controllers/user/patchuserprofile.controller";
import { updateUserTimezone } from "@/controllers/user/updateUserTimezone.controller";
import { testEmailService } from "@/controllers/auth/test-email.controller";
import { markPasswordChanged } from "@/controllers/user/markpasswordchanged.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// USER PROFILE ROUTES
router.get("/profile", isAuthenticated, getCurrentUserProfile);
router.put("/profile", isAuthenticated, updateUserProfileController); // Full profile updates (name, email, phone, address)
router.patch("/profile", isAuthenticated, patchUserProfile); // Partial updates (2FA, notifications, etc.)
router.put("/profile/image", isAuthenticated, updateProfileImage);
router.put("/profile/timezone", isAuthenticated, updateUserTimezone);
router.post(
  "/profile/mark-password-changed",
  isAuthenticated,
  markPasswordChanged
);

// TEST EMAIL SERVICE
router.post("/test-email", isAuthenticated, testEmailService);

export default router;
