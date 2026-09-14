import { useEffect, useRef, useState } from 'react';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useListAiConsultMessages,
  useSendAiConsultMessage,
  useExecuteAiConsultPlan,
  useSaveAiConsultProposedRule,
  useDismissAiConsultSuggestion,
  getListAiConsultMessagesQueryKey,
  getListShiftsQueryKey,
  listShifts,
} from '@workspace/api-client-react';
import type { AiConsultMessage, Shift } from '@workspace/api-client-react';
import { aiUndoStore } from '@/lib/aiUndoStore';
import { ChevronLeft, Send, Sparkles, Check, X as XIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface Template {
  label: string;
  text: string;
  /** Parts in the text that the user should replace, shown as hints */
  hints?: string[];
}

const TEMPLATES: Template[] = [
  {
    label: '夜勤均等割り（リーダー残り担当）',
    text: '○の日に特2夜をリーダー以外4回上限で均等割りしてください',
    hints: ['「特2夜」をシフト種別名に、「4」を上限回数に変えてから送信してください'],
  },
  {
    label: '夜勤均等割り（全員均等）',
    text: '○の日に特2夜を均等に割り当ててください',
    hints: ['「特2夜」を割り当てたいシフト種別名に変えてから送信してください'],
  },
  {
    label: '最低休み日数を確保',
    text: '全員最低9回の休みを振り分けてください',
    hints: ['「9」を希望する最低休み日数に変えてください', '希望休・有給はすでに休みとしてカウントされます'],
  },
  {
    label: '施設ルール確認',
    text: '施設ルールを守っていますか？',
  },
  {
    label: '空欄を日勤で埋める',
    text: '全員の空欄を日勤で埋めてください',
  },
  {
    label: 'スタッフ指定で埋める',
    text: 'さんを希望休以外B2で埋めてください',
    hints: [
      '「さん」の前にスタッフ名、「B2」を対象シフト種別に変えてください',
      '特定スタッフ優先で埋めたい場合はこのテンプレートを実行後、「空欄をB2で埋めてください」を続けて送信してください',
    ],
  },
  {
    label: '夜勤を減らす',
    text: 'さんの夜勤を減らしてください',
    hints: ['「さん」の前にスタッフ名を入れてください'],
  },
  {
    label: '連勤を減らす',
    text: 'さんの連勤を減らしてください',
    hints: ['「さん」の前にスタッフ名を入れてください'],
  },
  {
    label: 'シフト固定',
    text: 'さんは基本だけにしてください',
    hints: ['「さん」の前にスタッフ名、「基本」の後にシフト種別を入れてください'],
  },
];

function TemplatePanel({ onSelect }: { onSelect: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const handleSelect = (t: Template) => {
    onSelect(t.text);
    setHint(t.hints?.[0] ?? null);
    setOpen(false);
  };

  return (
    <div className="px-4 md:px-6 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-bold text-violet-600 py-1"
      >
        <Sparkles className="w-3.5 h-3.5" />
        テンプレートから選ぶ
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="flex flex-wrap gap-2 pb-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => handleSelect(t)}
              className="px-3 py-1.5 bg-violet-50 border border-violet-100 text-violet-700 text-xs font-bold rounded-full active:scale-95 transition-transform"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {hint && !open && (
        <p className="text-[11px] text-amber-600 font-medium pb-1">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion card (execute_plan_request / teach_candidate)
// ---------------------------------------------------------------------------

// Partial AI Execution (intentType "execute_plan_request") and Teach Shift
// Sensei (intentType "teach_candidate") both attach a pending suggestion to
// the *assistant* message via intentPayload.plan / intentPayload.proposedRule.
// Nothing is ever applied/saved automatically — this card is the only way
// to confirm or dismiss it, and intentPayload.status tracks the outcome so
// a resolved card renders as a a static summary instead of buttons again.
function SuggestionCard({ message, month }: { message: AiConsultMessage; month: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAiConsultMessagesQueryKey() });
  const executePlan = useExecuteAiConsultPlan();
  const saveRule = useSaveAiConsultProposedRule();
  const dismiss = useDismissAiConsultSuggestion();

  const payload = message.intentPayload;
  const plan = payload?.plan;
  const proposedRule = payload?.proposedRule;
  const status = payload?.status ?? 'pending';
  if (!plan && !proposedRule) return null;

  const isPending = executePlan.isPending || saveRule.isPending || dismiss.isPending;

  const handleConfirm = async () => {
    try {
      if (plan) {
        // Snapshot current shifts BEFORE executing so the shifts page can
        // push an undo entry when the user navigates back.
        const shiftsKey = getListShiftsQueryKey({ month });
        const cached = queryClient.getQueryData<Shift[]>(shiftsKey);
        const before = cached ?? await listShifts({ month });
        aiUndoStore.storeBefore(month, before);

        await executePlan.mutateAsync({ id: message.id });
      } else {
        await saveRule.mutateAsync({ id: message.id });
      }
      await invalidate();
    } catch {
      toast.error('処理に失敗しました');
    }
  };

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync({ id: message.id });
      await invalidate();
    } catch {
      toast.error('処理に失敗しました');
    }
  };

  return (
    <div className="max-w-[90%] bg-violet-50 border border-violet-100 rounded-2xl rounded-bl-sm px-4 py-3 space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-600 uppercase tracking-wide">
        <Sparkles className="w-3.5 h-3.5" />
        {plan ? 'Partial AI Execution' : 'Teach Shift Sensei'}
      </div>

      {plan && (
        <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-gray-700 bg-white/70 rounded-xl p-2.5">
          {plan.changes.slice(0, 20).map((change, index) => (
            <div key={index}>
              {change.date.slice(-5)}: {change.staffName} → {change.code}
            </div>
          ))}
          {plan.changes.length > 20 && (
            <div className="text-gray-400">他{plan.changes.length - 20}件…</div>
          )}
        </div>
      )}

      {proposedRule && (
        <div className="text-xs text-gray-700 bg-white/70 rounded-xl p-2.5">
          <p className="font-bold text-gray-900 mb-1">{proposedRule.name}</p>
          <p>{proposedRule.description}</p>
        </div>
      )}

      {status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => void handleConfirm()}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-1.5 bg-violet-600 text-white text-sm font-bold py-2.5 rounded-xl active:scale-95 transition-transform disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {plan ? '実行する' : '保存する'}
          </button>
          <button
            onClick={() => void handleDismiss()}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white text-gray-600 text-sm font-bold py-2.5 rounded-xl border border-gray-200 active:scale-95 transition-transform disabled:opacity-50"
          >
            <XIcon className="w-4 h-4" />
            見送る
          </button>
        </div>
      )}
      {status === 'applied' && (
        <p className="text-xs font-bold text-emerald-600">
          実行済み（適用 {payload?.appliedCount ?? 0}件 / スキップ {payload?.skippedCount ?? 0}件）
        </p>
      )}
      {status === 'saved' && <p className="text-xs font-bold text-emerald-600">施設ルールとして保存しました</p>}
      {status === 'dismissed' && <p className="text-xs font-bold text-gray-400">見送りました</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AiConsultPage() {
  const { data: messages = [], isLoading } = useListAiConsultMessages();
  const sendMessage = useSendAiConsultMessage();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [, , workingMonthStr] = useWorkingMonth(true);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, sendMessage.isPending]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      await sendMessage.mutateAsync({ data: { content, month: workingMonthStr } });
      await queryClient.invalidateQueries({ queryKey: getListAiConsultMessagesQueryKey() });
    } catch {
      toast.error('送信に失敗しました');
      setInput(content);
    }
  };

  const handleTemplateSelect = (text: string) => {
    setInput(text);
    // Focus the input so the user can immediately edit
    setTimeout(() => {
      inputRef.current?.focus();
      // Place cursor at a sensible edit point (first placeholder position)
      const pos = text.indexOf('さん');
      if (pos !== -1) {
        inputRef.current?.setSelectionRange(pos, pos);
      }
    }, 50);
  };

  return (
    <div className="min-h-full flex flex-col max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2 p-4 md:p-6 pb-2 flex-shrink-0">
        <Link
          href="/shift-sensei"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">💬 AI相談</h1>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))] px-6 mb-2">
        試作版のため、あらかじめ用意した内容にのみ返答します。会話内容はスタッフの希望として記録されます。
      </p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-3 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 bg-white border border-gray-100 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-sm font-bold text-gray-700 mb-1">シフトの相談をしてみましょう</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              下の「テンプレートから選ぶ」を使うと便利です
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn('flex flex-col gap-2', message.role === 'user' ? 'items-end' : 'items-start')}
            >
              <div
                className={cn(
                  'max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words',
                  message.role === 'user'
                    ? 'bg-[hsl(var(--primary))] text-white rounded-br-sm'
                    : 'bg-white border border-gray-100 text-gray-800 shadow-sm rounded-bl-sm',
                )}
              >
                {message.content}
              </div>
              {message.role === 'assistant' && <SuggestionCard message={message} month={workingMonthStr} />}
            </div>
          ))
        )}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-gray-400">
              入力中…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0">
        <TemplatePanel onSelect={handleTemplateSelect} />
        <div className="p-4 md:p-6 pt-2 flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="メッセージを入力、またはテンプレートを選ぶ"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
          />
          <button
            onClick={() => void handleSend()}
            disabled={sendMessage.isPending || !input.trim()}
            className="w-12 h-12 flex-shrink-0 flex items-center justify-center bg-[hsl(var(--primary))] text-white rounded-xl shadow-sm active:scale-95 transition-transform disabled:opacity-50"
            aria-label="送信"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
