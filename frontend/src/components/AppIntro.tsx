import React from 'react';
import '../styles/AppIntro.css';
import { Logo } from './Logo';

interface AppIntroProps {
  theme: 'light' | 'dark';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
  onSignInClick: () => void;
}

export const AppIntro: React.FC<AppIntroProps> = ({ theme, setTheme, onSignInClick }) => {
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <div className="intro-root" data-mode={theme}>
      <div className="intro-glow-1" />
      <div className="intro-glow-2" />

      <nav className="intro-nav">
        <div className="intro-logo">
          <Logo size={24} variant="full" />
        </div>
        <button className="intro-theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? 'LIGHT' : 'DARK'} MODE
        </button>
      </nav>

      <main className="intro-content">
        <div className="intro-tag">EMTY DESKTOP</div>
        <h1 className="intro-hl">
          Keep it <span>emty.</span>
        </h1>
        <p className="intro-sub">
          Your inbox knows what matters. Emty silently reads, categorises, and clears the noise — bringing only the most crucial signals to your attention.
        </p>

        <div className="intro-actions">
          <button className="intro-btn-primary" onClick={onSignInClick}>
            Sign In / Get Started
          </button>
        </div>
      </main>

      <footer className="intro-footer">
        <div>© 2026 emty.</div>
        <div className="intro-footer-status">
          <div className="intro-dot" />
          SYSTEM SECURE
        </div>
      </footer>
    </div>
  );
};
