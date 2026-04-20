import React, { useState, useEffect } from 'react';
import '../styles/SystemLoader.css';

const MESSAGES = [
  'INITIALIZING SUBSYSTEMS',
  'WAKING UP LOCAL CLUSTER',
  'ESTABLISHING SECURE CONNECTION',
  'LOADING PREFERENCES',
  'INITIALIZING AI ENGINE',
  'STARTING ENGINE',
  
];

export const SystemLoader: React.FC = () => {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % MESSAGES.length);
    }, 1800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="sys-loader-root">
      <div className="sys-loader-logo">
        <svg viewBox="0 0 28 28" fill="none">
          <rect x="1.5" y="1.5" width="25" height="25" stroke="currentColor" strokeWidth="2.2" />
          <polygon points="14,5 22,14 14,23 6,14" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>

      <div className="sys-loader-status">
        {MESSAGES[msgIndex]}<span className="typing-cursor" style={{ marginLeft: 6 }}>_</span>
      </div>

      <div className="sys-loader-skeleton">
        <div className="sys-sk-line l1" />
        <div className="sys-sk-line l2" />
        <div className="sys-sk-line l3" />
      </div>

      <div className="sys-loader-note">
        // DEPENDENCIES CHECK · EMTY OS
      </div>
    </div>
  );
};
