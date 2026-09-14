import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 text-center">
      <h1 className="text-4xl font-bold mb-2">404</h1>
      <p className="text-[hsl(var(--muted-foreground))] mb-6">ページが見つかりません</p>
      <Link href="/" className="bg-[hsl(var(--primary))] text-white px-6 py-3 rounded-xl font-bold shadow-sm active:scale-95 transition-transform">
        ホームに戻る
      </Link>
    </div>
  );
}
