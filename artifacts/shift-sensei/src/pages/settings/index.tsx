import { Link } from 'wouter';
import { Users, ChevronRight, Tags, ClipboardCheck, ShieldCheck, Printer, Trash2 } from 'lucide-react';

const MENU_ITEMS = [
  {
    href: '/staff',
    icon: Users,
    label: 'スタッフ管理',
    description: '氏名・カラーの登録・編集',
  },
  {
    href: '/settings/shift-types',
    icon: Tags,
    label: 'シフト種別',
    description: 'スタンプの追加・編集・並び替え',
  },
  {
    href: '/settings/month-end-check',
    icon: ClipboardCheck,
    label: '月末チェック設定',
    description: '連勤・休日・夜勤バランスの基準',
  },
  {
    href: '/settings/facility-rules',
    icon: ShieldCheck,
    label: '施設ルール',
    description: 'ユニットごとの人員配置ルール',
  },
  {
    href: '/export',
    icon: Printer,
    label: 'シフト表出力',
    description: 'PDF・JPEGで保存して印刷や共有に',
  },
  {
    href: '/settings/data-management',
    icon: Trash2,
    label: 'データ管理',
    description: '月ごとのデータを項目別に完全削除',
    danger: true,
  },
];

export default function SettingsPage() {
  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 mt-4">設定</h1>

      <div className="space-y-3">
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="w-full bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 active:scale-[0.98] transition-transform touch-manipulation"
            >
              <div className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full flex-shrink-0">
                <Icon className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-bold text-gray-900">{item.label}</h3>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  {item.description}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
