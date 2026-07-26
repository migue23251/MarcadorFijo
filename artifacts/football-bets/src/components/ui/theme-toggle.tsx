import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = [
  { value: "light",  label: "Claro",    Icon: Sun },
  { value: "dark",   label: "Oscuro",   Icon: Moon },
  { value: "system", label: "Sistema",  Icon: Monitor },
] as const;

type ThemeValue = (typeof OPTIONS)[number]["value"];

interface ThemeToggleProps {
  /** "icon" shows only the current-state icon; "full" shows label too */
  variant?: "icon" | "full";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className = "" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className={`w-9 h-9 rounded-md ${className}`} aria-hidden />
    );
  }

  const current = (OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]) as (typeof OPTIONS)[number];
  const { Icon } = current;

  function cycle() {
    const idx = OPTIONS.findIndex((o) => o.value === theme);
    const next = OPTIONS[(idx + 1) % OPTIONS.length] as (typeof OPTIONS)[number];
    setTheme(next.value);
  }

  if (variant === "full") {
    return (
      <button
        onClick={cycle}
        title={`Tema: ${current.label} — hacer clic para cambiar`}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full ${className}`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <span>{current.label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={cycle}
      title={`Tema: ${current.label} — hacer clic para cambiar`}
      className={`flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${className}`}
    >
      <Icon className="w-5 h-5" />
      <span className="sr-only">Cambiar tema ({current.label})</span>
    </button>
  );
}
