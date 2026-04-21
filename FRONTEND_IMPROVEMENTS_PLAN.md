# Frontend UI Improvements - Implementation Plan

**Scope**: FRONTEND FOLDER ONLY (`frontend/src/`)  
**Status**: Ready for implementation

---

## 📋 Overview

This plan outlines 5 interconnected improvements to the frontend UI/UX, based on analysis of the existing codebase architecture.

## 🎯 Tasks

### ✅ Task 1: Store Light/Dark Theme Globally (FOUNDATIONAL)
**Priority**: 🔴 HIGHEST (all other tasks depend on theme consistency)

**Current State**:
- Theme stored in React state only (`App.tsx` line 41: `const [theme, setTheme] = useState<'light' | 'dark'>('light')`)
- Theme applied to `document.documentElement.setAttribute('data-mode', theme)` (line 170)
- CSS system fully supports light/dark via CSS variables in `index.css`
- No persistence to localStorage

**What to change**:
1. **Initialize theme from localStorage** on App mount
   - Check `localStorage.getItem('app-theme')` 
   - Fallback to system preference using `window.matchMedia('(prefers-color-scheme: dark)')`
   - Default to 'light' if all else fails
2. **Save theme to localStorage** whenever user toggles it
   - Update `setTheme()` calls to also write to localStorage
3. **Sync across tabs** (optional: use storage event listener)

**Files to modify**:
- `frontend/src/App.tsx` (lines 30-45, 170-175)

**Expected outcome**:
- ✓ Theme persists across browser sessions
- ✓ User preference remembered even after closing app
- ✓ Consistent light/dark appearance on every launch

---

### 🎨 Task 2: Enhance Scrollbar UI (THEME-AWARE)
**Priority**: 🟡 MEDIUM (visual polish)

**Current State**:
- No custom scrollbar styling
- Uses browser default scrollbars
- Doesn't match cyan/terminal aesthetic

**What to change**:
1. **Add webkit scrollbar styles** for Chrome/Safari/Edge
   - Light mode: dark track, light thumb with cyan accent
   - Dark mode: dark track, cyan glowing thumb
2. **Add Firefox support** (limited via `scrollbar-width` and `scrollbar-color`)
3. **Target scrollable containers**: 
   - `.cal-list` (calendar items)
   - `.agenda-rows` (email list)
   - `.det-body` (detail panel content)
   - `.track` (board cards)

**CSS pattern** (example):
```css
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: var(--surface);
}

::-webkit-scrollbar-thumb {
  background: var(--accent);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--accent-strong);
}
```

**Files to modify**:
- `frontend/src/index.css` (add new scrollbar section after CSS variable definitions)
- `frontend/src/styles/Dashboard.css` (if container-specific tweaks needed)

**Expected outcome**:
- ✓ Theme-aware scrollbars in light and dark modes
- ✓ Cyan accent reflects in scrollbar thumb
- ✓ Smoother, more polished UI appearance

---

### 📅 Task 3: Expand Calendar to Full View (LAYOUT)
**Priority**: 🟡 MEDIUM (UX improvement - easier navigation)

**Current State**:
- Calendar sidebar fixed at 280px when open
- Can collapse to 44px (icon-only mode)
- Grid layout: `gridTemplateColumns: ${sidebarCol ? '44px' : '176px'} ${calendarCol ? '280px' : '0px'} 1fr ${rightCol ? 'minmax(300px, 45vw)' : '0px'}`
- Calendar items have small text and minimal spacing

**What to change**:
1. **Expand calendar width** from 280px → `minmax(320px, 40vw)` (proportional, similar to detail panel)
2. **Improve calendar grid layout**:
   - Increase day cell size
   - Larger month title
   - Better spacing between elements
3. **Enhance calendar items list**:
   - Bigger font sizes (especially `.cal-item` `.ci-from`)
   - More padding
   - Better hover state styling
4. **Update DAY cell styling**:
   - Larger numbers
   - Better visual indicator for today/selected
   - Clearer deadline/event dots

**CSS changes** in `frontend/src/styles/Dashboard.css`:
- `.cal-sidebar` width increase
- `.cal-grid` cell sizing
- `.cal-item` padding/font sizing
- `.cal-month` font size increase
- Date number sizing

**Files to modify**:
- `frontend/src/styles/Dashboard.css` (calendar-related classes)
- `frontend/src/components/Dashboard.tsx` (line 1025-1026: grid template update if needed)

**Expected outcome**:
- ✓ Calendar takes ~40% of rightmost area (matching detail panel proportion)
- ✓ Calendar items are clearly readable
- ✓ Easier to navigate and select dates
- ✓ More professional, spacious appearance

---

### 🏷️ Task 4: Add Logo (BRANDING)
**Priority**: 🟡 MEDIUM (visual branding, but not blocking features)

**Current State**:
- Simple logo block in header (lines 1053-1060 of Dashboard.tsx)
- Just a colored square with horizontal lines
- Text "Emty" next to it

**What to change**:
1. **Create or import an app logo**:
   - Option A: Design a proper SVG logo for "Emty" brand
   - Option B: Use existing React SVG logo if available
   - Consider: should reflect cyan/terminal aesthetic
2. **Replace `.logo-block` SVG** with proper logo
3. **Update sizing** if needed
4. **Ensure responsiveness** (hide logo on very small screens if needed)
5. **Add to landing page** (LandingPage.tsx) for consistency

**Logo placement**:
- `frontend/src/components/Dashboard.tsx` (line 1053-1060) - in `<div className="bar-logo">`
- `frontend/src/components/LandingPage.tsx` - if applicable
- Consider `frontend/src/components/Profile.tsx` - if applicable

**Files to create/modify**:
- Create `frontend/src/assets/logo.svg` (or similar)
- `frontend/src/components/Dashboard.tsx` (import + replace logo SVG)
- `frontend/src/App.tsx` (if logo needed in auth shell)

**Expected outcome**:
- ✓ Professional branded logo visible in header
- ✓ Consistent Emty branding across app
- ✓ Logo matches cyan/terminal design aesthetic

---

### 🐛 Task 5: Fix "Open in Gmail" Button (BUG FIX)
**Priority**: 🔴 HIGHEST (feature not working)

**Current State**:
- Button exists at line 1282 of Dashboard.tsx: `<button className="det-btn pri" onClick={openSelectedInGmail} disabled={!selectedEmail}>Open in Gmail</button>`
- Function at line 536-538:
  ```typescript
  const openSelectedInGmail = () => {
    if (!selectedEmail?.gmailThreadId) return;
    window.open(`https://mail.google.com/mail/u/0/#all/${selectedEmail.gmailThreadId}`, '_blank', 'noopener,noreferrer');
  };
  ```
- Button is disabled `disabled={!selectedEmail}` — good safeguard
- Potential issues:
  - `selectedEmail` object not fully populated
  - `gmailThreadId` is undefined or empty string
  - Popup blocker or browser security
  - URL format incorrect for Gmail

**Investigation steps**:
1. Check if `selectedEmail?.gmailThreadId` exists in console
   - Add debug logging: `console.log('Opening Gmail:', selectedEmail?.gmailThreadId)`
2. Verify data structure from API
   - Check `/api/emails/priority-ranking` response includes `gmailThreadId`
3. Test URL format
   - Gmail URL pattern should be: `https://mail.google.com/mail/u/0/#all/{THREAD_ID}`
   - Some versions use `/#inbox/{THREAD_ID}` or `/#search/{THREAD_ID}`

**Fixes to apply**:
1. **Add error boundary + logging**:
   ```typescript
   const openSelectedInGmail = () => {
     if (!selectedEmail?.gmailThreadId) {
       console.warn('Cannot open Gmail: missing gmailThreadId', selectedEmail);
       return;
     }
     const gmailUrl = `https://mail.google.com/mail/u/0/#all/${selectedEmail.gmailThreadId}`;
     console.log('Opening Gmail URL:', gmailUrl);
     const newTab = window.open(gmailUrl, '_blank', 'noopener,noreferrer');
     if (!newTab) {
       console.error('Failed to open new tab - popup may be blocked');
       // Could add toast notification here
     }
   };
   ```
2. **Add fallback URL patterns** (try multiple formats if one fails)
3. **User feedback** on failure (toast notification)
4. **Verify API response** includes gmailThreadId

**Files to modify**:
- `frontend/src/components/Dashboard.tsx` (lines 536-538, and optionally add notification)

**Expected outcome**:
- ✓ Button opens correct Gmail thread in new tab
- ✓ Better error handling and logging
- ✓ Clear feedback to user if action fails
- ✓ Console logs show what's happening

---

## 📊 Task Dependency Graph

```
Task 1 (Theme Persistence)
  ↓
  ├→ Task 2 (Scrollbar styling) — uses CSS variables from persistent theme
  ├→ Task 3 (Calendar expansion) — CSS styling, independent
  └→ Task 4 (Logo) — independent
  
Task 5 (Gmail button fix) — independent from all others
```

**Implementation Order**:
1. ✅ **Task 1** (Theme) — foundational, enables testing of Tasks 2-3
2. ✅ **Task 2** (Scrollbars) — quick CSS win
3. ✅ **Task 3** (Calendar) — CSS/styling changes
4. ✅ **Task 4** (Logo) — branding
5. ✅ **Task 5** (Gmail fix) — bug fix

---

## 🔍 Files to Touch

**Summary of files**:
```
frontend/src/
├── App.tsx                              [Task 1, possibly Task 4]
├── components/
│   ├── Dashboard.tsx                    [Tasks 3, 4, 5]
│   ├── LandingPage.tsx                  [Task 4 - optional]
│   └── CalendarSidebar.tsx              [Task 3 - optional tweaks]
├── styles/
│   └── Dashboard.css                    [Tasks 2, 3]
├── index.css                            [Tasks 2]
├── assets/
│   └── [logo.svg]                       [Task 4 - new file]
└── hooks/
    └── useAppTheme.ts                   [Task 1 - optional enhancement]
```

---

## ✨ Expected Final Result

After all tasks:
- ✅ Light/dark theme persists across sessions
- ✅ Custom cyan-themed scrollbars in all dropdowns
- ✅ Calendar expands to full ~40% width with improved typography
- ✅ Professional Emty logo in header
- ✅ "Open in Gmail" button works reliably with error handling

---

## 🚀 Ready to Start?

Each task is independent enough that you can work on them in parallel or sequentially. Task 1 should be done first since it's foundational, but Tasks 2-4 can be done in any order.

**No backend changes required** — all changes are frontend-only as requested. ✓
