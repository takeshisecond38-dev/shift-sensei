import { format, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { Shift, ShiftType, Staff } from '@workspace/api-client-react';

// Fixed A4-landscape-proportioned canvas (297:210mm ≈ 1.4142:1). Kept at a
// moderate CSS pixel size for cheap DOM layout — actual print/export
// resolution comes from html2canvas's `scale` option at capture time, not
// from inflating this size, so on-screen preview and file generation always
// stay in perfect sync (same DOM, same component).
export const PRINT_WIDTH = 1600;
export const PRINT_HEIGHT = Math.round(PRINT_WIDTH * (210 / 297));

const STAFF_COL_WIDTH = 130;
const PADDING = 28;

type Props = {
  month: Date;
  staffList: Staff[];
  shifts: Shift[];
  shiftTypeByCode: Map<string, ShiftType>;
  remarksByDate: Map<string, string>;
};

// The single source of truth for what シフト表出力 renders — used twice:
// once off-screen at natural size for html2canvas capture, once visually
// scaled down for the on-screen preview. Never rendered inside the normal
// shift-input screen, so tweaking this can't affect day-to-day editing.
export default function PrintableShiftTable({
  month,
  staffList,
  shifts,
  shiftTypeByCode,
  remarksByDate,
}: Props) {
  const daysInMonth = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const bodyWidth = PRINT_WIDTH - PADDING * 2 - STAFF_COL_WIDTH;
  const colWidth = bodyWidth / daysInMonth.length;
  const headerRowHeight = 56;
  const remarksRowHeight = 72;
  const titleHeight = 40;
  // Staff rows fill 100% of the height left over after the title, the date
  // header, and the 備考 row — no leftover "spacer" space is left inside the
  // table, so 備考 always sits flush against the last shift row. Growing to
  // fill the page (instead of capping at a small fixed row height) is also
  // what makes the shift codes and staff names larger/easier to read.
  const availableBodyHeight = PRINT_HEIGHT - PADDING * 2 - titleHeight - headerRowHeight - remarksRowHeight;
  const staffRowHeight = Math.max(30, availableBodyHeight / Math.max(1, staffList.length));
  const staffFontSize = Math.min(15, Math.max(12, staffRowHeight * 0.34));
  const cellFontSize = Math.min(15, Math.max(12, staffRowHeight * 0.34));

  const shiftByStaffAndDate = new Map<string, Shift>();
  for (const s of shifts) shiftByStaffAndDate.set(`${s.staffId}_${s.date}`, s);

  return (
    <div
      style={{
        width: PRINT_WIDTH,
        height: PRINT_HEIGHT,
        padding: PADDING,
        background: '#ffffff',
        fontFamily:
          '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
        color: '#1a1a1a',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: titleHeight,
          fontSize: 26,
          fontWeight: 700,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {format(month, 'yyyy年M月', { locale: ja })} シフト表
      </div>

      {/* Shift table and 備考 are one continuous bordered block (not two
          separate boxes with a gap) so they read as a single table. */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', border: '1.5px solid #333' }}>
        {/* Header: date + weekday per column */}
        <div style={{ display: 'flex', height: headerRowHeight, flexShrink: 0 }}>
          <div
            style={{
              width: STAFF_COL_WIDTH,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
              borderRight: '1.5px solid #333',
              borderBottom: '1.5px solid #333',
              background: '#f3f4f6',
            }}
          >
            職員
          </div>
          {daysInMonth.map((day) => {
            const dow = day.getDay();
            const bg = dow === 0 ? '#fee2e2' : dow === 6 ? '#dbeafe' : '#f9fafb';
            const color = dow === 0 ? '#b91c1c' : dow === 6 ? '#1d4ed8' : '#374151';
            return (
              <div
                key={day.toString()}
                style={{
                  width: colWidth,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRight: '0.75px solid #999',
                  borderBottom: '1.5px solid #333',
                  background: bg,
                  color,
                  lineHeight: 1.2,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>{format(day, 'd')}</div>
                <div style={{ fontSize: 10 }}>{format(day, 'E', { locale: ja })}</div>
              </div>
            );
          })}
        </div>

        {/* Body: one row per staff member. Rows grow to fill all remaining
            vertical space (no fixed/capped row height), which both makes
            the shift codes bigger/easier to read and guarantees the last
            row's bottom border sits exactly where the 備考 row begins. */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {staffList.map((staff) => (
            <div key={staff.id} style={{ display: 'flex', height: staffRowHeight, flexShrink: 0 }}>
              <div
                style={{
                  width: STAFF_COL_WIDTH,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 8px',
                  fontSize: staffFontSize,
                  fontWeight: 600,
                  borderRight: '1.5px solid #333',
                  borderBottom: '0.75px solid #999',
                  background: '#fafafa',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: staff.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {staff.name}
                </span>
              </div>
              {daysInMonth.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const shift = shiftByStaffAndDate.get(`${staff.id}_${dateStr}`);
                const type = shift?.code ? shiftTypeByCode.get(shift.code) : undefined;
                return (
                  <div
                    key={day.toString()}
                    style={{
                      width: colWidth,
                      flexShrink: 0,
                      borderRight: '0.75px solid #999',
                      borderBottom: '0.75px solid #999',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: type?.bgColor ?? '#ffffff',
                      color: type?.textColor ?? '#000000',
                      fontWeight: 700,
                      fontSize: cellFontSize,
                    }}
                  >
                    {type?.shortLabel ?? shift?.code ?? ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* 備考 row — directly beneath the last staff row, no separating
            gap, so each date's shift and its 備考 line up in one glance. */}
        <div style={{ display: 'flex', height: remarksRowHeight, flexShrink: 0 }}>
          <div
            style={{
              width: STAFF_COL_WIDTH,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
              borderRight: '1.5px solid #333',
              borderTop: '1.5px solid #333',
              background: '#fef3c7',
            }}
          >
            備考
          </div>
          {daysInMonth.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const text = remarksByDate.get(dateStr) ?? '';
            return (
              <div
                key={day.toString()}
                style={{
                  width: colWidth,
                  flexShrink: 0,
                  borderRight: '0.75px solid #999',
                  borderTop: '1.5px solid #333',
                  background: '#fffbeb',
                  fontSize: 10,
                  lineHeight: 1.2,
                  padding: '3px 2px',
                  overflow: 'hidden',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
