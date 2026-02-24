import type { IO } from "./socket.types";
import type { auth } from "@/lib/auth";

type Session = typeof auth.$Infer.Session;

declare module "express" {
  interface Request {
    session?: Session;
    io?: IO;
    user?: {
      id: string;
      email: string;
      role: string;
      organizationId?: string;
      name?: string;
      emailVerified?: boolean;
      isSuperAdmin?: boolean;
      isOrganizationOwner?: boolean;
      isOrganizationManager?: boolean;
      timezone?: string;
      createdAt?: Date;
      updatedAt?: Date;
      organization?: any;
      userOrganization?: any;
    };
    subscription?: any;
    subscriptionStatus?: {
      hasSubscription: boolean;
      status: string;
      subscription?: any;
      message: string;
    };
  }
}

declare module "socket.io" {
  interface Socket {
    session?: Session;
  }
}
