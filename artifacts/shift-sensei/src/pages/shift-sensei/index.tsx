import { Link } from 'wouter';

const CARDS = [
  { icon: '📅', label: '月末チェック', href: '/shift-sensei/month-end-check' },
  { icon: '💡', label: 'おすすめ', href: '/shift-sensei/recommendations' },
  { icon: '💬', label: 'AI相談', href: '/shift-sensei/ai-consult' },
  { icon: '🏥', label: '施設ルール', href: '/settings/facility-rules' },
];

export default function ShiftSenseiPage() {
  return (
    <div className="flex h-full flex-col items-center gap-6 overflow-y-auto px-4 py-10 text-center">
      <div className="text-5xl">🤖</div>
      <div>
        <h1 className="text-xl font-bold text-foreground">シフト先生</h1>
        <p className="mt-1 text-xs text-muted-foreground">Version 0.1 Prototype</p>
      </div>

      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        {CARDS.map((card) =>
          card.href ? (
            <Link
              key={card.label}
              href={card.href}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-6 text-card-foreground shadow-sm active:scale-[0.98] transition-transform touch-manipulation"
            >
              <span className="text-2xl">{card.icon}</span>
              <span className="text-sm font-medium">{card.label}</span>
            </Link>
          ) : (
            <div
              key={card.label}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-6 text-card-foreground shadow-sm"
            >
              <span className="text-2xl">{card.icon}</span>
              <span className="text-sm font-medium">{card.label}</span>
              <span className="text-[11px] text-muted-foreground">準備中</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
