import { useState, useMemo } from 'react';
import type { PriorityRankingItem } from './Dashboard';
import '../styles/Dashboard.css';

interface CalendarSidebarProps {
  isOpen: boolean;
  items: PriorityRankingItem[];
  onSelectEmail: (item: PriorityRankingItem) => void;
  onClose: () => void;
}

type DayEntry = { type: 'd' | 'e'; item: PriorityRankingItem };

const getItemSubject = (item: PriorityRankingItem) =>
  item.emailContextById?.[item.gmailThreadId]?.subject || item.summary.shortSnippet || 'No subject';

const getItemInitials = (item: PriorityRankingItem) =>
  (item.from.name || item.from.email || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

export function CalendarSidebar({ isOpen, items, onSelectEmail, onClose }: CalendarSidebarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 is Sunday

  // date-key → entries (deadlines first, then events)
  const processedItems = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    items.forEach(item => {
      if (!Array.isArray(item.dates)) return;
      item.dates.forEach(d => {
        if (!d.date) return;
        const dObj = new Date(d.date);
        if (Number.isNaN(dObj.getTime())) return;
        if (d.type !== 'deadline' && d.type !== 'event') return;
        const key = `${dObj.getFullYear()}-${dObj.getMonth()}-${dObj.getDate()}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ type: d.type === 'deadline' ? 'd' : 'e', item });
      });
    });
    map.forEach(entries => entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'd' ? -1 : 1)));
    return map;
  }, [items]);

  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const changeMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1));
  };

  const goToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const isSameDay = (d1: Date | null, d2: Date) => {
    if (!d1) return false;
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  };

  const isToday = (d: Date) => isSameDay(new Date(), d);

  // 42 cells (leading + trailing padding days) so the grid always fills 6 rows
  const generateCalendarDays = () => {
    const days = [];
    const prevMonthDays = new Date(year, month, 0).getDate();

    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isCurrentMonth: false, date: new Date(year, month - 1, prevMonthDays - i) });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, isCurrentMonth: true, date: new Date(year, month, i) });
    }
    const remainingSlots = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) });
    }
    return days;
  };

  const daysLabels = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month];

  // Entries for the selected date
  const selectedEntries = useMemo<DayEntry[]>(() => {
    if (!selectedDate) return [];
    return processedItems.get(keyOf(selectedDate)) || [];
  }, [selectedDate, processedItems]);

  const deadlineCount = selectedEntries.filter(e => e.type === 'd').length;
  const eventCount = selectedEntries.filter(e => e.type === 'e').length;

  // Upcoming — next 7 days after the selected date (or today)
  const upcoming = useMemo(() => {
    const base = selectedDate || new Date();
    const rows: Array<{ date: Date; entry: DayEntry }> = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const entries = processedItems.get(keyOf(d)) || [];
      entries.forEach(entry => rows.push({ date: d, entry }));
    }
    return rows.slice(0, 6);
  }, [selectedDate, processedItems]);

  return (
    <div className={`cal-sidebar ${!isOpen ? 'col' : ''}`}>
      <div className="cv-main">
        {/* Toolbar */}
        <div className="cv-toolbar">
          <span className="cv-title">{monthName} <span className="cv-title-year">{year}</span></span>
          <div className="cv-nav">
            <button className="cv-nav-btn" onClick={() => changeMonth(-1)} aria-label="Previous month">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="cv-nav-btn" onClick={() => changeMonth(1)} aria-label="Next month">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <button className="cv-today-btn" onClick={goToday}>TODAY</button>
          <div className="cv-legend">
            <span className="cv-legend-item"><span className="cv-legend-sq" style={{ background: 'var(--red)' }} />Deadline</span>
            <span className="cv-legend-item"><span className="cv-legend-sq" style={{ background: 'var(--event)' }} />Event</span>
          </div>
          <button className="cv-close" onClick={onClose} aria-label="Close calendar">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 2L9 9M9 2L2 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Month grid */}
        <div className="cv-grid">
          {daysLabels.map(lbl => (
            <div className="cv-dw" key={lbl}>{lbl}</div>
          ))}
          {generateCalendarDays().map((d, i) => {
            const entries = processedItems.get(keyOf(d.date)) || [];
            const shown = entries.slice(0, 2);
            const overflow = entries.length - shown.length;

            return (
              <div
                className={`cv-cell ${!d.isCurrentMonth ? 'off' : ''} ${isToday(d.date) ? 'today' : ''} ${isSameDay(selectedDate, d.date) ? 'sel' : ''}`}
                key={i}
                onClick={() => setSelectedDate(d.date)}
              >
                {d.day}
                {d.isCurrentMonth && shown.map((entry, j) => (
                  <div className={`cv-chip ${entry.type}`} key={j}>
                    {getItemSubject(entry.item)}
                  </div>
                ))}
                {d.isCurrentMonth && overflow > 0 && (
                  <span className="cv-more">+{overflow} more</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day rail */}
      <div className="cv-rail">
        <div className="cv-rail-hd">
          <div className="cv-rail-title">
            {selectedDate
              ? selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
              : 'Select a date'}
          </div>
          <div className="cv-rail-meta">
            {deadlineCount} deadline{deadlineCount === 1 ? '' : 's'} · {eventCount} event{eventCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="cv-rail-list">
          {selectedEntries.length === 0 && (
            <div className="cv-rail-empty">No deadlines or events this day.</div>
          )}
          {selectedEntries.map((entry, idx) => (
            <div
              className={`cv-ritem ${entry.type}`}
              key={entry.item.insightId + idx}
              onClick={() => onSelectEmail(entry.item)}
            >
              <div className="cv-ritem-top">
                <div className="cv-rav">{getItemInitials(entry.item)}</div>
                <span className="cv-rfrom">{entry.item.from.name || entry.item.from.email.split('@')[0]}</span>
                <span className={`cv-rtype ${entry.type}`}>{entry.type === 'd' ? 'Deadline' : 'Event'}</span>
              </div>
              <div className="cv-rsub">{getItemSubject(entry.item)}</div>
              <div className="cv-rsnip">{entry.item.summary.shortSnippet}</div>
            </div>
          ))}

          {upcoming.length > 0 && (
            <>
              <div className="cv-up-lbl">Upcoming this week</div>
              {upcoming.map(({ date, entry }, idx) => (
                <div
                  className="cv-up-row"
                  key={entry.item.insightId + idx}
                  onClick={() => onSelectEmail(entry.item)}
                >
                  <span className="cv-up-date">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <span className={`cv-up-sq ${entry.type}`} />
                  <span className="cv-up-title">{getItemSubject(entry.item)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
