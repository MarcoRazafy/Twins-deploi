"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { isNavItemVisible, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import { Logo, LogoMark } from "@/components/shared/logo";
import { StatusDot } from "@/components/shared/status-badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { DeploymentFilter } from "@/lib/api/contract";
import { APP_NAME } from "@/lib/constants";
import { pluralize } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { useDeployments, useProjects, useSession } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Same set as `isDeploymentInFlight` in @/lib/status, filtered server side.
const IN_FLIGHT_FILTER: DeploymentFilter = { statuses: ["queued", "building", "deploying"] };

interface LiveCounts {
  inFlightDeployments: number;
  crashedServices: number;
}

interface LiveBadge {
  tone: "info" | "danger";
  count: number;
  /** Spoken to screen readers and appended to the tooltip of the collapsed sidebar. */
  hint: string;
}

function getLiveBadge(itemId: string, counts: LiveCounts): LiveBadge | null {
  if (itemId === "deployments" && counts.inFlightDeployments > 0) {
    const count = counts.inFlightDeployments;
    return { tone: "info", count, hint: `${count} en cours` };
  }
  if (itemId === "docker" && counts.crashedServices > 0) {
    const count = counts.crashedServices;
    return { tone: "danger", count, hint: `${pluralize(count, "service")} en erreur` };
  }
  return null;
}

function LiveBadgeView({ badge }: { badge: LiveBadge }) {
  const isInfo = badge.tone === "info";
  return (
    <>
      <SidebarMenuBadge
        className={cn(
          "gap-1.5 rounded-full px-1.5",
          isInfo
            ? "bg-info/10 text-info peer-hover/menu-button:text-info peer-data-active/menu-button:text-info"
            : "bg-destructive/15 text-destructive peer-hover/menu-button:text-destructive peer-data-active/menu-button:text-destructive",
        )}
      >
        {isInfo ? <StatusDot tone="info" pulse /> : null}
        <span aria-hidden="true">{badge.count}</span>
        <span className="sr-only">{badge.hint}</span>
      </SidebarMenuBadge>
      {/* The pill is hidden when the sidebar is collapsed: keep a dot on the icon. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full ring-2 ring-sidebar group-data-[collapsible=icon]:block",
          isInfo ? "bg-info" : "bg-destructive",
        )}
      />
    </>
  );
}

interface NavMenuItemProps {
  item: NavItem;
  active: boolean;
  badge: LiveBadge | null;
  onNavigate: () => void;
}

function NavMenuItem({ item, active, badge, onNavigate }: NavMenuItemProps) {
  const { icon: Icon } = item;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={badge ? `${item.label} · ${badge.hint}` : item.label}
      >
        <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {active ? (
        <motion.span
          layoutId="sidebar-active-indicator"
          transition={SPRING.snappy}
          aria-hidden="true"
          className="pointer-events-none absolute top-2 -left-2 h-4 w-[3px] rounded-r-full bg-brand-500"
        />
      ) : null}
      {badge ? <LiveBadgeView badge={badge} /> : null}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ onResetDemo }: { onResetDemo: () => void }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { data: inFlight } = useDeployments(IN_FLIGHT_FILTER);
  const { data: projects } = useProjects();
  const role = useSession().data?.user?.role ?? null;

  const counts: LiveCounts = {
    inFlightDeployments: inFlight?.length ?? 0,
    crashedServices: projects?.reduce((total, project) => total + project.stats.crashed, 0) ?? 0,
  };
  // Navigating keeps the layout mounted: the mobile sheet has to close itself.
  const closeMobile = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 shrink-0 justify-center gap-0 border-b border-sidebar-border px-2.5 py-0">
        <Link
          href={routes.dashboard()}
          aria-label={`${APP_NAME}, retour au dashboard`}
          onClick={closeMobile}
          className="flex w-fit items-center rounded-md ring-sidebar-ring outline-hidden focus-visible:ring-2"
        >
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <LogoMark className="hidden group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="Navigation principale">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel className="text-muted-foreground">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.filter((item) => isNavItemVisible(item, role)).map((item) => (
                  <NavMenuItem
                    key={item.id}
                    item={item}
                    active={item.isActive(pathname)}
                    badge={getLiveBadge(item.id, counts)}
                    onNavigate={closeMobile}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavMenuItem
                item={SETTINGS_ITEM}
                active={SETTINGS_ITEM.isActive(pathname)}
                badge={null}
                onNavigate={closeMobile}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu onResetDemo={onResetDemo} />
      </SidebarFooter>
    </Sidebar>
  );
}
