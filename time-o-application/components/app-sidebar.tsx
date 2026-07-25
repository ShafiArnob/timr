"use client";

import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { type QuickCreateTask } from "@/components/quick-create-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  BookOpenIcon,
  LayoutDashboardIcon,
  Settings2Icon,
  DatabaseIcon,
  CommandIcon,
  TimerIcon,
} from "lucide-react";

type SidebarData = {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
  navMain?: Array<{
    title: string;
    url: string;
    icon: React.ReactNode;
  }>;
  navSecondary?: Array<{
    title: string;
    url: string;
    icon: React.ReactNode;
  }>;
  /** Feeds the Quick Create dialog's task picker. */
  tasks?: QuickCreateTask[];
};

const defaultData: SidebarData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: <LayoutDashboardIcon />,
    },
    {
      title: "Timer",
      url: "/timer",
      icon: <TimerIcon />,
    },
    {
      title: "API",
      url: "/api",
      icon: <DatabaseIcon />,
    },
    {
      title: "API docs",
      url: "/api/docs",
      icon: <BookOpenIcon />,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: <Settings2Icon />,
    },
  ],
  navSecondary: [],
  tasks: [],
};

export function AppSidebar({
  data: sidebarData,
  ...props
}: React.ComponentProps<typeof Sidebar> & { data?: SidebarData }) {
  const resolvedData = {
    ...defaultData,
    ...(sidebarData ?? {}),
    user: {
      ...defaultData.user,
      ...(sidebarData?.user ?? {}),
    },
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="#" />}
            >
              <CommandIcon className="size-5!" />
              <span className="text-base font-semibold">Acme Inc.</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={resolvedData.navMain ?? []}
          tasks={resolvedData.tasks ?? []}
        />
        <NavSecondary
          items={resolvedData.navSecondary ?? []}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={resolvedData.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
