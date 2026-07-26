import { ReactNode } from "react";
import { Sidebar } from "./sidebar";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="h-[100dvh] bg-background text-foreground flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-64 pb-16 md:pb-0 overflow-x-hidden overflow-y-auto relative">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}