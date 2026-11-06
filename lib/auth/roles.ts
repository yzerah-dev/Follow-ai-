export type MemberRole = "owner" | "admin" | "manager" | "commercial" | "read_only";

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Manager",
  commercial: "Commercial",
  read_only: "Lecture seule",
};

export const canWrite = (r: MemberRole) => r !== "read_only";
export const canManage = (r: MemberRole) => r === "owner" || r === "admin" || r === "manager";
export const isAdmin = (r: MemberRole) => r === "owner" || r === "admin";

export class ForbiddenError extends Error {
  constructor(message = "Action non autorisée pour votre rôle.") {
    super(message);
  }
}

export function assertCan(check: (r: MemberRole) => boolean, role: MemberRole) {
  if (!check(role)) throw new ForbiddenError();
}
