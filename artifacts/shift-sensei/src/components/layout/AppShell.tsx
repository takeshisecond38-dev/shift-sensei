import { Link, useLocation } from 'wouter';
import { CalendarDays, Bot, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: '/', icon: CalendarDays, label: 'シフト' },
    { href: '/shift-sensei', icon: Bot, label: 'シフト先生' },
    { href: '/settings', icon: Settings, label: '設定' },
  ];

  return (
    <div className="flex flex-col h-[100dvh] bg-[hsl(var(--background))]">
      {/* Portrait: a slim, icon-only bar (44px) leaves far more room for the
          grid than the old 64px label+icon bar. Landscape: hidden entirely
          — screen height is already tight, and the grid expands to fill
          the reclaimed space via the matching `landscape:pb-*` below. */}
      <main className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+36px)] landscape:pb-[env(safe-area-inset-bottom)]">
        {children}
      </main>

      <nav className="fixed bottom-0 w-full bg-white border-t border-[hsl(var(--border))] pb-[env(safe-area-inset-bottom)] z-50 landscape:hidden">
        <div className="flex justify-around items-center h-9">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className="flex-1 flex items-center justify-center h-full select-none tap-highlight-transparent active:opacity-70"
              >
                <Icon
                  strokeWidth={isActive ? 2.5 : 2}
                  className={cn(
                    "w-5 h-5 transition-all duration-200",
                    isActive ? "text-[hsl(var(--primary))] scale-110" : "text-[hsl(var(--muted-foreground))]"
                  )}
                />
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
