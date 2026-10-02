"use client";

import { useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { TableShell } from "@/components/shared/table-shell";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MEMBER_ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { useProfile, useRemoveMember, useTeamMembers, useUpdateMember } from "@/lib/queries";
import type { MemberRole, TeamMember } from "@/lib/types";

import { notifyError } from "../lib/errors";
import { QueryBoundary } from "./form-parts";
import { InviteMemberDialog } from "./invite-member-dialog";

const ASSIGNABLE: ReadonlyArray<Exclude<MemberRole, "owner">> = ["admin", "developer", "viewer"];

function StatusPill({ status }: { status: TeamMember["status"] }) {
  return status === "active" ? (
    <Badge className="border border-success/25 bg-success/10 text-success">Actif</Badge>
  ) : (
    <Badge className="border border-warning/25 bg-warning/10 text-warning">Invité</Badge>
  );
}

function Protected({ locked, reason, children }: { locked: boolean; reason: string; children: React.ReactNode }) {
  if (!locked) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

interface RoleSelectProps {
  member: TeamMember;
  role: MemberRole;
  busy: boolean;
  onChange: (role: MemberRole) => void;
}

function RoleSelect({ member, role, busy, onChange }: RoleSelectProps) {
  const isOwner = member.role === "owner";
  return (
    <Protected locked={isOwner} reason="Le propriétaire ne peut pas être modifié.">
      <Select value={role} disabled={isOwner || busy} onValueChange={(value) => onChange(value as MemberRole)}>
        <SelectTrigger size="sm" className="w-36" aria-label={`Rôle de ${member.name}`}>
          <SelectValue>{MEMBER_ROLE_LABELS[role]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {isOwner ? (
            <SelectItem value="owner">{MEMBER_ROLE_LABELS.owner}</SelectItem>
          ) : (
            ASSIGNABLE.map((value) => (
              <SelectItem key={value} value={value}>
                {MEMBER_ROLE_LABELS[value]}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </Protected>
  );
}

interface MemberRowProps {
  member: TeamMember;
  isSelf: boolean;
  role: MemberRole;
  roleBusy: boolean;
  onRoleChange: (role: MemberRole) => void;
  onRemove: () => void;
}

function MemberRow({ member, isSelf, role, roleBusy, onRoleChange, onRemove }: MemberRowProps) {
  const isOwner = member.role === "owner";
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <UserAvatar name={member.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {member.name}
              {isSelf ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vous)</span> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
              <StatusPill status={member.status} />
            </div>
            <div className="mt-2 sm:hidden">
              <RoleSelect member={member} role={role} busy={roleBusy} onChange={onRoleChange} />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <RoleSelect member={member} role={role} busy={roleBusy} onChange={onRoleChange} />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <StatusPill status={member.status} />
      </TableCell>
      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(member.joinedAt)}</TableCell>
      <TableCell className="text-right">
        <Protected
          locked={isOwner || isSelf}
          reason={isOwner ? "Le propriétaire ne peut pas être retiré." : "Vous ne pouvez pas vous retirer vous-même."}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Retirer ${member.name}`}
            disabled={isOwner || isSelf}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </Protected>
      </TableCell>
    </TableRow>
  );
}

function MembersSkeleton() {
  return (
    <div aria-busy className="divide-y border-t">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44 max-w-full" />
          </div>
          <Skeleton className="h-7 w-36" />
        </div>
      ))}
    </div>
  );
}

export function MembersSection() {
  const members = useTeamMembers();
  const profile = useProfile();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [target, setTarget] = useState<TeamMember | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function changeRole(member: TeamMember, role: MemberRole) {
    updateMember.mutate(
      { id: member.id, role },
      {
        onSuccess: () =>
          toast.success("Rôle mis à jour", { description: `${member.name} : ${MEMBER_ROLE_LABELS[role]}` }),
        onError: notifyError,
      },
    );
  }

  async function confirmRemove() {
    if (!target) return;
    try {
      await removeMember.mutateAsync(target.id);
      toast.success("Membre retiré", { description: target.name });
      setConfirmOpen(false);
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <>
      <SectionCard
        flush
        className="overflow-hidden"
        title="Membres"
        description="Les personnes qui ont accès à cet espace de travail et leur rôle."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus data-icon="inline-start" />
            Inviter un membre
          </Button>
        }
      >
        <QueryBoundary query={members} skeleton={<MembersSkeleton />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState compact icon={Users} title="Aucun membre" description="Invitez quelqu’un pour collaborer." />
            ) : (
              <TableShell className="rounded-none border-x-0 border-b-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Membre</TableHead>
                      <TableHead className="hidden sm:table-cell">Rôle</TableHead>
                      <TableHead className="hidden md:table-cell">Statut</TableHead>
                      <TableHead className="hidden lg:table-cell">Arrivé le</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((member) => {
                      const pending = updateMember.isPending && updateMember.variables.id === member.id;
                      return (
                        <MemberRow
                          key={member.id}
                          member={member}
                          isSelf={profile.data?.id === member.id}
                          role={pending ? updateMember.variables.role : member.role}
                          roleBusy={pending}
                          onRoleChange={(role) => changeRole(member, role)}
                          onRemove={() => {
                            setTarget(member);
                            setConfirmOpen(true);
                          }}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              </TableShell>
            )
          }
        </QueryBoundary>
      </SectionCard>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={`Retirer ${target?.name ?? "ce membre"}`}
        description="Cette personne perdra immédiatement l’accès à l’espace de travail."
        confirmLabel="Retirer"
        loading={removeMember.isPending}
        onConfirm={confirmRemove}
      />
    </>
  );
}
