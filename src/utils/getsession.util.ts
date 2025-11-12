import { auth } from "@/lib/auth";

export const getSession = async <T extends { headers: any }>(req: T) =>
  await auth.api.getSession({
    headers: req.headers as unknown as Headers,
  });
