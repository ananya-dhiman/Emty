import React from 'react';

interface LogoProps {
  size?: number;
  variant?: 'icon' | 'text' | 'full';
  className?: string;
  style?: React.CSSProperties;
}

export const LogoMark: React.FC<LogoProps> = ({ size = 24, className = '', style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    {/* Frame - Left and Bottom */}
    <rect x="8" y="8" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="6" />
    
    {/* Diamond/Arrow Shape */}
    <g stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Diamond outline */}
      <path d="M 32 16 L 48 32 L 32 48 L 16 32 Z" />
      
      {/* Horizontal line through center */}
      <line x1="16" y1="32" x2="48" y2="32" />
      
      {/* Arrow chevron pointing right */}
      <path d="M 40 24 L 48 32 L 40 40" />
    </g>
  </svg>
);

export const LogoText: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <span
    className={className}
    style={{
      fontFamily: "'Courier New', monospace",
      fontSize: `${size}px`,
      fontWeight: 700,
      letterSpacing: '0.05em',
      color: 'currentColor',
    }}
  >
    emty
  </span>
);

export const Logo: React.FC<LogoProps> = ({ size = 24, variant = 'icon', className = '', style = {} }) => {
  if (variant === 'text') {
    return <LogoText size={size} className={className} />;
  }
  if (variant === 'full') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...style }} className={className}>
        <LogoMark size={size} />
        <LogoText size={size * 0.75} />
      </div>
    );
  }
  return <LogoMark size={size} className={className} style={style} />;
};
