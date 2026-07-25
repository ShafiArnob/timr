"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  QuickCreateDialog,
  type QuickCreateTask,
} from "@/components/quick-create-dialog"
import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { MailIcon } from "lucide-react"

export function NavMain({
  items,
  tasks,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
  tasks: QuickCreateTask[]
}) {
  const pathname = usePathname()

  // Nested entries like /api/docs also match their parent's prefix, so only the
  // longest match counts — otherwise two rows highlight at once.
  const activeUrl = items.reduce((longest, item) => {
    const matches = pathname === item.url || pathname.startsWith(`${item.url}/`)
    return matches && item.url.length > longest.length ? item.url : longest
  }, "")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <QuickCreateDialog tasks={tasks} />
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <MailIcon
              />
              <span className="sr-only">Inbox</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.url === activeUrl}
                render={<Link href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
