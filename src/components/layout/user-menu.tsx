"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, KeyRound, LogOut, RotateCcw, Settings, User } from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/shared/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { API_MODE, getErrorMessage } from "@/lib/api";
import { CURRENT_USER_NAME } from "@/lib/constants";
import { useLogout, useProfile } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * A component of its own on purpose: it is the only one that follows the
 * mutation, so the menu above (which holds live queries) does not re-render,
 * and refetch, against the cache that sign-out has just emptied.
 */
export function SignOutItem({ onSignOut }: { onSignOut: () => void }) {
  const router = useRouter();
  const logout = useLogout();

  const signOut = async () => {
    onSignOut();
    try {
      await logout.mutateAsync();
    } catch (error) {
      toast.error(getErrorMessage(error));
      return;
    }
    router.replace("/login");
  };

  return (
    <DropdownMenuItem disabled={logout.isPending} onSelect={() => void signOut()}>
      <LogOut />
      Se déconnecter
    </DropdownMenuItem>
  );
}

export function UserMenu({ onResetDemo }: { onResetDemo: () => void }) {
  const { data: profile, isPending } = useProfile();
  const { isMobile, setOpenMobile } = useSidebar();

  if (isPending) {
    return (
      <div
        aria-busy="true"
        className="flex h-12 items-center gap-2 p-2 group-data-[collapsible=icon]:p-0"
      >
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="grid flex-1 gap-1.5 group-data-[collapsible=icon]:hidden">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  const name = profile?.name ?? CURRENT_USER_NAME;
  const email = profile?.email ?? "";
  const closeMobile = () => setOpenMobile(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={name} aria-label={`Menu du compte, ${name}`}>
              <UserAvatar name={name} size="md" />
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium text-foreground">{name}</span>
                {email ? (
                  <span className="truncate text-xs text-muted-foreground">{email}</span>
                ) : null}
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="w-64"
          >
            <DropdownMenuLabel className="flex items-center gap-2.5 p-2 font-normal text-foreground">
              <UserAvatar name={name} size="md" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                {email ? (
                  <span className="truncate text-xs text-muted-foreground">{email}</span>
                ) : null}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={routes.settings("profile")} onClick={closeMobile}>
                  <User />
                  Profil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={routes.settings()} onClick={closeMobile}>
                  <Settings />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={routes.settings("tokens")} onClick={closeMobile}>
                  <KeyRound />
                  Jetons d’API
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {API_MODE === "http" ? (
              <SignOutItem onSignOut={closeMobile} />
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  closeMobile();
                  onResetDemo();
                }}
              >
                <RotateCcw />
                Réinitialiser la démo
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
