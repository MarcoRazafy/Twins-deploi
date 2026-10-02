import type { User } from "@/generated/prisma/client";
import type { TeamMember, UserProfile } from "@/lib/types";

export function toUserProfile(row: User): UserProfile {
  return { id: row.id, name: row.name, email: row.email, role: row.role, avatarUrl: row.avatarUrl };
}

export function toTeamMember(row: User): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatarUrl,
    status: row.status,
    joinedAt: row.createdAt.toISOString(),
  };
}
