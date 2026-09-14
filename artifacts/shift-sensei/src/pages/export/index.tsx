import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parse } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, FileDown, Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useListShiftMonths,
  useListStaff,
  useListShifts,
  useListShiftTypes,
  useListDayRemarks,
} from '@workspace/api-client-react';
import PrintableShiftTable, { PRINT_WIDTH, PRINT_HEIGHT } from './PrintableShiftTable';

type Step = 'select' | 'preview';

// シフト表出力: 対象月を選ぶ -> 印刷プレビュー -> PDF/JPEG保存。
//
// Deliberately its own route, reached only from シフト先生/設定 — never
// rendered inside src/pages/shifts (the shift-input screen), so this
// feature can never eat into that screen's grid space.
//
// The exported file and the on-screen preview are guaranteed to match
// pixel-for-pixel because both come from the exact same
// <PrintableShiftTable> instance: only its CSS `transform: scale(...)` for
// on-screen display differs, and html2canvas re-rasterizes that same DOM
// node at high resolution (via its own `scale` option) for the actual
// PDF/JPEG — so "what you see is what gets exported".
//
// Extension point for future 印刷/LINE共有/メール送信/AirPrint/画像共有:
// all of those just need the same `buildCanvas()` (or a Blob from it), so
// add a new button next to PDF/JPEG that calls it and hands the result to
// whatever channel is being added, rather than duplicating capture logic.
export default function ExportPage() {
  const [step, setStep] = useState<Step>('select');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'jpeg' | null>(null);

  const { data: months = [], isLoading: monthsLoading } = useListShiftMonths();
  const { data: staffList = [] } = useListStaff();
  const { data: shiftTypes = [] } = useListShiftTypes();
  // No `enabled` gating needed: on the 'select' step `selectedMonth` is
  // null, so these just request the (small) unfiltered dataset once and
  // sit unused until a month is picked — simpler than fighting the
  // generated hooks' strict UseQueryOptions typing for a negligible cost.
  const { data: shifts = [] } = useListShifts(
    selectedMonth ? { month: selectedMonth } : undefined,
  );
  const { data: dayRemarks = [] } = useListDayRemarks(
    selectedMonth ? { month: selectedMonth } : undefined,
  );

  const shiftTypeByCode = useMemo(() => new Map(shiftTypes.map((t) => [t.code, t])), [shiftTypes]);
  const remarksByDate = useMemo(() => new Map(dayRemarks.map((r) => [r.date, r.text])), [dayRemarks]);
  const monthDate = selectedMonth ? parse(selectedMonth, 'yyyy-MM', new Date()) : null;
  const monthLabel = monthDate ? format(monthDate, 'yyyy年M月', { locale: ja }) : '';

  // The capture target: rendered off-screen at natural (unscaled) size so
  // html2canvas always measures/rasterizes the real print layout, never a
  // CSS-transformed copy of it.
  const captureRef = useRef<HTMLDivElement>(null);

  // The visible preview: the same component, shrunk to fit the screen via
  // `transform: scale`, in a container whose reserved height matches the
  // scaled size so it never overlaps the buttons below it.
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.24);
  useEffect(() => {
    if (step !== 'preview') return;
    const el = previewWrapRef.current;
    if (!el) return;
    const update = () => setPreviewScale(Math.max(0.15, el.clientWidth / PRINT_WIDTH));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  const openPreview = (month: string) => {
    setSelectedMonth(month);
    setStep('preview');
  };
  const handleBack = () => {
    setStep('select');
    setSelectedMonth(null);
  };

  const buildCanvas = async () => {
    if (!captureRef.current) throw new Error('printable node not mounted');
    const { default: html2canvas } = await import('html2canvas');
    return html2canvas(captureRef.current, {
      // 3x the on-screen CSS pixel size keeps shift codes and 備考 text
      // crisp when printed at A4 — this is the resolution knob for print
      // quality, independent of PRINT_WIDTH/HEIGHT (layout size).
      scale: 3,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting('pdf');
    try {
      const canvas = await buildCanvas();
      const { jsPDF } = await import('jspdf');
      // A4 landscape, image-fit-to-page — 印刷品質優先 so the JPEG feeding
      // the PDF stays at high quality (0.95) rather than the smaller size
      // used for the shareable JPEG export below.
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidth, pageHeight);
      pdf.save(`シフト表_${monthLabel}.pdf`);
      // No position override here: this page's bottom bar (PDF保存/JPEG保存
      // buttons) sits exactly where a `bottom-center` toast would render,
      // and the toast's pointer-events can swallow the very next tap on
      // those buttons. Use the app-wide default (top-center) instead.
      toast.success('PDFを保存しました');
    } catch (e) {
      console.error(e);
      toast.error('PDFの保存に失敗しました');
    } finally {
      setExporting(null);
    }
  };

  const handleExportJpeg = async () => {
    if (exporting) return;
    setExporting('jpeg');
    try {
      const canvas = await buildCanvas();
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('failed to encode JPEG'));
              return;
            }
            // LINEやメールに添付しやすい画質 — 0.9 keeps file size reasonable
            // while still reading clearly on a phone screen.
            downloadBlob(blob, `シフト表_${monthLabel}.jpg`);
            resolve();
          },
          'image/jpeg',
          0.9,
        );
      });
      toast.success('JPEGを保存しました');
    } catch (e) {
      console.error(e);
      toast.error('JPEGの保存に失敗しました');
    } finally {
      setExporting(null);
    }
  };

  if (step === 'select') {
    return (
      <div className="min-h-full p-4 md:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1 mt-4">シフト表出力</h1>
        <p className="text-sm text-gray-500 mb-6">出力する月を選択してください</p>

        {monthsLoading ? (
          <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
        ) : months.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            保存済みのシフトがありません。
            <br />
            シフトを入力すると、ここから出力できるようになります。
          </div>
        ) : (
          <div className="space-y-2">
            {months.map((month) => (
              <button
                key={month}
                onClick={() => openPreview(month)}
                className="w-full bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.98] transition-transform touch-manipulation"
              >
                <span className="font-bold text-gray-900">
                  {format(parse(month, 'yyyy-MM', new Date()), 'yyyy年M月', { locale: ja })}
                </span>
                <span className="text-xs text-gray-400">プレビュー</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // step === 'preview'
  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={handleBack}
          disabled={!!exporting}
          className="p-2 -m-2 rounded-full text-gray-500 active:bg-gray-100 disabled:opacity-40"
          aria-label="戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="font-bold text-gray-900 text-sm">{monthLabel} のプレビュー</h2>
      </div>

      <div ref={previewWrapRef} className="flex-1 overflow-y-auto p-3 flex justify-center">
        <div style={{ width: '100%', maxWidth: PRINT_WIDTH }}>
          <div
            style={{
              width: PRINT_WIDTH * previewScale,
              height: PRINT_HEIGHT * previewScale,
              overflow: 'hidden',
              boxShadow: '0 1px 8px rgba(0,0,0,0.15)',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                width: PRINT_WIDTH,
                height: PRINT_HEIGHT,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
              }}
            >
              {monthDate && (
                <PrintableShiftTable
                  month={monthDate}
                  staffList={staffList}
                  shifts={shifts}
                  shiftTypeByCode={shiftTypeByCode}
                  remarksByDate={remarksByDate}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-3 border-t border-gray-200 bg-white shrink-0 pb-[env(safe-area-inset-bottom)]">
        <button
          onClick={handleExportPdf}
          disabled={!!exporting}
          className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-xl bg-gray-900 text-white font-bold text-sm active:bg-gray-800 disabled:opacity-50"
        >
          {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          PDF保存
        </button>
        <button
          onClick={handleExportJpeg}
          disabled={!!exporting}
          className="flex-1 flex items-center justify-center gap-1.5 h-11 rounded-xl bg-amber-500 text-white font-bold text-sm active:bg-amber-600 disabled:opacity-50"
        >
          {exporting === 'jpeg' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
          JPEG保存
        </button>
      </div>

      {/* Off-screen capture target — same component/props as the visible
          preview above, kept at natural (unscaled) size so html2canvas
          always rasterizes the true print layout. Positioned off-screen
          rather than display:none/visibility:hidden, both of which
          html2canvas cannot capture. */}
      <div style={{ position: 'fixed', top: 0, left: -99999, pointerEvents: 'none' }} aria-hidden>
        <div ref={captureRef}>
          {monthDate && (
            <PrintableShiftTable
              month={monthDate}
              staffList={staffList}
              shifts={shifts}
              shiftTypeByCode={shiftTypeByCode}
              remarksByDate={remarksByDate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
