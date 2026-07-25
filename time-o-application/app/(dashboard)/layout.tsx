import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { getTasks, getUser } from "@/lib/dal";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Dashboard",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, tasks] = await Promise.all([getUser(), getTasks()]);

  const sidebarData = {
    user: {
      name: user?.name ?? "Guest",
      email: user?.email ?? "guest@example.com",
      avatar: "/avatars/shadcn.jpg",
    },
    // Quick Create logs against a task, so the picker needs the same list —
    // in the same manual order — that the rest of the app uses.
    tasks: tasks.map((task) => ({
      id: task.id,
      label: task.label,
      color: task.color,
    })),
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" data={sidebarData} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
