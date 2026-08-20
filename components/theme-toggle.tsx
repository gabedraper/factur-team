"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "factur-theme";

export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // The inline script in app/layout.tsx has already applied the stored choice
  // before paint; read back off the element rather than storage so the two can
  // never disagree.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  const label = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`w-full gap-2 text-muted-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
      {!collapsed && label}
    </Button>
  );
}
