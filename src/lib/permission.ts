import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";
import { createAccessControl } from "better-auth/plugins/access";

const pages = {
  ...defaultStatements,
  Dashboard: ["view"],
  Companies: ["create", "read", "update", "delete", "impersonate"],
  Projects: ["create", "read", "update", "delete"],
  Subscriptions: ["create", "view", "read", "update", "delete"],
  "Sub Admin": ["create", "read", "update", "delete"],
  Calender: ["create", "read", "update", "delete"],
  TimeTracking: ["read", "update"],
  "Task Management": ["create", "read", "update", "delete"],
  "User Management": ["read", "update", "delete", "create"],
  "Demo Accounts": ["create", "read", "update", "delete"],
  "Client Management": ["read", "update", "delete", "create"],
  "Support Tickets": ["create", "view", "read", "update", "delete"],
  "AI Assist": ["use", "view", "update", "delete", "create"],
  "My Tasks": ["read", "update", "delete", "create"],
  Settings: ["create", "view", "update", "delete"],
  Notifications: ["read", "view", "update", "delete"],
} as const;

export const ac = createAccessControl(pages);

// Super Admin: Business owner - can manage companies
export const superadmin = ac.newRole({
  Dashboard: ["view"],
  Companies: ["create", "read", "update", "delete", "impersonate"],
  Subscriptions: ["create", "view", "read", "update", "delete"],
  "Sub Admin": ["create", "read", "update", "delete"],
  "Demo Accounts": ["create", "read", "update", "delete"],
  "Support Tickets": ["create", "view", "read", "update", "delete"],
  Settings: ["view"],
  Notifications: ["read", "view", "update", "delete"],
  ...adminAc.statements,
});

export const subadmin = ac.newRole({
  Dashboard: ["view"],
  Companies: ["create", "read", "update", "delete", "impersonate"],
  "Support Tickets": ["create", "view", "read", "update", "delete"],
  Settings: ["view"],
  Notifications: ["read", "view", "update", "delete"],
  ...adminAc.statements,
});

// viewer: Can view the projects , tasks and create a support tickek
export const viewer = ac.newRole({
  Dashboard: ["view"],
  Projects: ["read"],
  "My Tasks": ["read"],
  Calender: ["create", "read", "update", "delete"],
  "AI Assist": ["use", "view", "update", "delete", "create"],
  "Support Tickets": ["create", "read", "update", "delete"],
  Settings: ["view"],
  Notifications: ["read", "view", "update", "delete"],
});

// user: Basic user role - can view dashboard and their own tasks
export const user = ac.newRole({
  Dashboard: ["view"],
  Projects: ["create", "read", "update", "delete"],
  Subscriptions: ["create", "view", "read", "update", "delete"],
  "User Management": ["read", "update", "delete", "create"],
  "Client Management": ["read", "update", "delete", "create"],
  TimeTracking: ["read", "update"],
  "Task Management": ["create", "read", "update", "delete"],
  "Support Tickets": ["create", "view", "read", "update", "delete"],
  Calender: ["create", "read", "update", "delete"],
  "AI Assist": ["use", "view", "update", "delete", "create"],
  "My Tasks": ["read", "update", "delete", "create"],
  Settings: ["create", "view", "update", "delete"],
  Notifications: ["read", "view", "update", "delete"],
});

// operator: Can perform all user actions plus some additional permissions
export const operator = ac.newRole({
  Dashboard: ["view"],
  Projects: ["read", "update"],
  "My Tasks": ["read", "update"],
  TimeTracking: ["read", "update"],
  "Support Tickets": ["create", "read", "update", "delete"],
  Settings: ["view", "update"],
  Notifications: ["read", "view", "update", "delete"],
});

// client: Can view dashboard and their own projects
export const client = ac.newRole({
  Dashboard: ["view"],
  Projects: ["read"],
  Calender: ["read"],
  "Support Tickets": ["create", "read"],
  Notifications: ["read", "view"],
});

// Export roles for the adminClient plugin - using the correct structure
export const roles = {
  superadmin,
  operator,
  subadmin,
  viewer,
  user,
  client,
};
