import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Radar, History, Settings, Shield, LogOut, User } from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const navItems = [
  { href: "/dashboard", label: "Radar", icon: Radar },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  
  const { data: me } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!user,
    }
  });

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const isAdmin = me?.role === "admin";
  const items = [...navItems];
  if (isAdmin) {
    items.push({ href: "/admin", label: "Administración", icon: Shield });
  }

  const handleSignOut = () => {
    signOut({ redirectUrl: basePath || "/" });
  };

  const initials = user?.primaryEmailAddress?.emailAddress?.substring(0, 2).toUpperCase() || "U";

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-sidebar h-[100dvh] fixed left-0 top-0">
        <div className="p-6 flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="MarcadorFijo" className="w-8 h-8" />
          <span className="text-xl font-bold tracking-tight text-primary">MarcadorFijo</span>
        </div>
        
        <nav className="flex-1 px-4 flex flex-col gap-2 mt-4">
          {items.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4 px-2">
            <Avatar className="w-9 h-9 border border-border">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-muted text-muted-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-foreground truncate">{me?.name || "Usuario"}</span>
              <span className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</span>
            </div>
          </div>
          <ThemeToggle variant="full" />
          <button 
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-sidebar z-50 flex items-center justify-around h-16 px-2 pb-safe">
        {items.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center w-full h-full gap-1 ${
                isActive ? "text-primary" : "text-sidebar-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}

        {/* Profile button */}
        <button
          onClick={() => setProfileOpen(true)}
          className="flex flex-col items-center justify-center w-full h-full gap-1 text-sidebar-foreground"
        >
          <Avatar className="w-5 h-5 border border-border">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-[10px] font-medium">Perfil</span>
        </button>
      </nav>

      {/* Mobile Profile Sheet */}
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-2xl pb-safe">
          <SheetHeader className="mb-4">
            <SheetTitle className="sr-only">Perfil</SheetTitle>
          </SheetHeader>

          {/* User info */}
          <div className="flex items-center gap-4 px-1 mb-6">
            <Avatar className="w-14 h-14 border border-border">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="text-lg bg-muted text-muted-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-base font-semibold text-foreground truncate">
                {me?.name || "Usuario"}
              </span>
              <span className="text-sm text-muted-foreground truncate">
                {user?.primaryEmailAddress?.emailAddress}
              </span>
              {me?.role === "admin" && (
                <span className="mt-1 text-xs font-medium text-primary">Administrador</span>
              )}
            </div>
          </div>

          {/* Theme toggle */}
          <div className="mb-3">
            <ThemeToggle variant="full" />
          </div>

          {/* Logout */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Cerrar sesión</span>
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}