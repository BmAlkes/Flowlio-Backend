import { sign, verify, SignOptions } from "jsonwebtoken";

export const generateJwt = (
  payload: any,
  expiresIn?: SignOptions["expiresIn"]
) => {
  return sign(payload, process.env.JWT_SECRET!, {
    expiresIn: expiresIn ?? 5 * 60,
  });
};

export const verifyJwt = <T = {}>(token: string) => {
  return verify(token, process.env.JWT_SECRET!) as T;
};
