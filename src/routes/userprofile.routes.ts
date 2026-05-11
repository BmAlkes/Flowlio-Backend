import { getCurrentUserProfile } from "@/controllers/user/profile.controller";
import { updateProfileImage } from "@/controllers/user/updateprofileimage.controller";
import { updateUserProfile as updateUserProfileController } from "@/controllers/user/updateuserprofile.controller";
import { patchUserProfile } from "@/controllers/user/patchuserprofile.controller";
import { updateUserTimezone } from "@/controllers/user/updateUserTimezone.controller";
import { testEmailService } from "@/controllers/auth/test-email.controller";
import { markPasswordChanged } from "@/controllers/user/markpasswordchanged.controller";
import { pingPortalActivity } from "@/controllers/user/pingactivity.controller";
import { verifyCurrentUserPassword } from "@/controllers/user/verifyuserpassword.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// ACTIVITY TRACKING
router.post("/ping-activity", isAuthenticated, pingPortalActivity);

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
router.post("/profile/verify-password", isAuthenticated, verifyCurrentUserPassword);

// TEST EMAIL SERVICE
router.post("/test-email", isAuthenticated, testEmailService);

export default router;
