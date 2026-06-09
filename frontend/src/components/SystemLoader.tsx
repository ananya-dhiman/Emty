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
      <div className="sharp-diamond-loader" style={{ marginBottom: '50px' }}></div>

      <div className="sys-loader-status">
        {MESSAGES[msgIndex]}<span className="typing-cursor" style={{ marginLeft: 6 }}>_</span>
      </div>

      <div className="sys-loader-note">
        // DEPENDENCIES CHECK · EMTY OS
      </div>
    </div>
  );
};
