import { useState, useMemo } from 'react';
import type { PriorityRankingItem } from './Dashboard';
import '../styles/Dashboard.css';

interface CalendarSidebarProps {
  isOpen: boolean;
  items: PriorityRankingItem[];
  onSelectEmail: (item: PriorityRankingItem) => void;
  onClose: () => void;
}

export function CalendarSidebar({ isOpen, items, onSelectEmail, onClose }: CalendarSidebarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 is Sunday

  // Get items with dates that fall in this month
  // Pre-process items
  const processedItems = useMemo(() => {
    const map = new Map<string, { deadlines: PriorityRankingItem[], events: PriorityRankingItem[] }>();
    items.forEach(item => {
      if (!Array.isArray(item.dates)) return;
      item.dates.forEach(d => {
        if (!d.date) return;
        const dObj = new Date(d.date);
        if (Number.isNaN(dObj.getTime())) return;
        const key = `${dObj.getFullYear()}-${dObj.getMonth()}-${dObj.getDate()}`;
        if (!map.has(key)) map.set(key, { deadlines: [], events: [] });
        if (d.type === 'deadline') map.get(key)!.deadlines.push(item);
        if (d.type === 'event') map.get(key)!.events.push(item);
      });
    });
    return map;
  }, [items]);

  const changeMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1));
  };

  const isSameDay = (d1: Date | null, d2: Date) => {
    if (!d1) return false;
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  };

  const isToday = (d: Date) => {
    const today = new Date();
    return isSameDay(today, d);
  };

  const generateCalendarDays = () => {
    const days = [];
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    // Previous month padding
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isCurrentMonth: false, date: new Date(year, month - 1, prevMonthDays - i) });
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, isCurrentMonth: true, date: new Date(year, month, i) });
    }
    // Next month padding
    const remainingSlots = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({ day: i, isCurrentMonth: false, date: new Date(year, month + 1, i) });
    }
    return days;
  };

  const daysLabels = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  // Get items for the selected date
  const selectedItems = useMemo(() => {
    if (!selectedDate) return [];
    const key = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    const dayData = processedItems.get(key);
    if (!dayData) return [];
    
    // Combine and deduplicate if same item is both a deadline and event
    const uniqueItems = new Map<string, PriorityRankingItem>();
    dayData.deadlines.forEach(i => uniqueItems.set(i.insightId, i));
    dayData.events.forEach(i => uniqueItems.set(i.insightId, i));
    
    return Array.from(uniqueItems.values());
  }, [selectedDate, processedItems]);

  return (
    <div className={`cal-sidebar ${!isOpen ? 'col' : ''}`}>
      <div className="cal-head">
        <span className="cal-title">CALENDAR</span>
        <button className="cal-close" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 2L9 9M9 2L2 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="cal-month">{monthNames[month]} {year}</span>
        <button className="cal-nav-btn" onClick={() => changeMonth(1)}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <div className="cal-grid">
        {daysLabels.map(lbl => (
          <div className="cal-dw" key={lbl}>{lbl}</div>
        ))}
        {generateCalendarDays().map((d, i) => {
          const key = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
          const dayData = processedItems.get(key);
          const hasDeadline = dayData && dayData.deadlines.length > 0;
          const hasEvent = dayData && dayData.events.length > 0;
          
          return (
            <div 
              className={`cal-day ${!d.isCurrentMonth ? 'off' : ''} ${isToday(d.date) ? 'today' : ''} ${isSameDay(selectedDate, d.date) ? 'sel' : ''}`}
              key={i}
              onClick={() => setSelectedDate(d.date)}
            >
              {d.day}
              <div className="cal-dots">
                {hasDeadline && <div className="cdot d" />}
                {hasEvent && <div className="cdot e" />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-agenda-head">
        <span className="cah-title">{selectedDate ? selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Select a date'}</span>
        <span className="cah-count">{selectedItems.length} items</span>
      </div>

      <div className="cal-list">
        {selectedItems.length === 0 && (
          <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '11px', textAlign: 'center' }}>No deadlines or events this day.</div>
        )}
        {selectedItems.map(item => {
          const key = `${selectedDate?.getFullYear()}-${selectedDate?.getMonth()}-${selectedDate?.getDate()}`;
          const dayData = processedItems.get(key);
          const isDeadline = dayData?.deadlines.some(d => d.insightId === item.insightId);
          const isEvent = dayData?.events.some(d => d.insightId === item.insightId);

          return (
            <div className="cal-item" key={item.insightId} onClick={() => onSelectEmail(item)}>
              <div className="ci-top">
                <span className="ci-from">{item.from.name || item.from.email.split('@')[0]}</span>
                <span className="ci-type-wrap">
                   {isDeadline && <span className="ci-type d">Deadline</span>}
                   {isEvent && <span className="ci-type e">Event</span>}
                </span>
              </div>
              <div className="ci-snip">{item.summary.shortSnippet}</div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
