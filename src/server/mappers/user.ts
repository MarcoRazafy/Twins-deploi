import type { User } from "@/generated/prisma/client";
import type { TeamMember, UserProfile } from "@/lib/types";

export function toUserProfile(row: User): UserProfile {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function toTeamMember(row: User): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt.toISOString(),
  };
}
