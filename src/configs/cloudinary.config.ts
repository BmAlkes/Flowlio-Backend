import { v2 as cloudinary } from "cloudinary";
import { env } from "@/utils/env.util";

const isProduction = process.env.NODE_ENV === "production";

cloudinary.config({
  api_secret: env.CLOUDINARY_API_SECRET,
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  secure: isProduction,
});

export { cloudinary };
