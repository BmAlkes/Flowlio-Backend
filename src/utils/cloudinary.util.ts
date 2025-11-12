import { cloudinary } from "@/configs/cloudinary.config";
import { ResourceType } from "cloudinary";
import { File } from "formidable";

export const uploadToCloudinary = async (
  file: File | string,
  folder: string,
  publicId?: string
) => {
  if (typeof file === "string") {
    // Handle base64 string
    return await cloudinary.uploader.upload(file, {
      public_id: publicId,
      resource_type: "auto",
      folder,
    });
  }

  // Handle formidable File
  const lastDotIndex = file.originalFilename?.lastIndexOf(".");
  const fileName = file.originalFilename?.substring(0, lastDotIndex);
  const cleanPublicId = publicId?.replace(`${folder}/`, "") ?? fileName;

  return await cloudinary.uploader.upload(file.filepath, {
    public_id: cleanPublicId,
    resource_type: "auto",
    folder,
  });
};

export const deleteSingleResouceFromCloudinary = (
  publicId: string,
  resource_type: ResourceType
) => {
  type DestroyResponse = { result: "not found" | "ok" };
  return new Promise<DestroyResponse["result"]>(async (resolve, reject) => {
    cloudinary.uploader
      .destroy(publicId, { resource_type })
      .then(({ result }: DestroyResponse) => {
        resolve(result);
      })
      .catch(() => {
        reject(`Image with public id ${publicId} not found.`);
      });
  });
};
