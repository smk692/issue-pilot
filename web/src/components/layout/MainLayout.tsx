import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { SSEStatus } from "../../hooks/useSSE";

interface MainLayoutProps {
  title: string;
  sseStatus: SSEStatus;
  uptime?: number;
  children: ReactNode;
}

export function MainLayout({ title, sseStatus, uptime, children }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} sseStatus={sseStatus} uptime={uptime} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
