import React from 'react';
import cyanOnBlack from '../assets/cyan_on_black.png';
import cyanOnWhite from '../assets/cyan_on_white.png';
import blackOnCyan from '../assets/black_on_cyan.png';

interface LogoProps {
  size?: number;
  variant?: 'icon' | 'text' | 'full';
  className?: string;
  style?: React.CSSProperties;
  onAccent?: boolean;
}

export const LogoMark: React.FC<LogoProps> = ({ size = 24, className = '', style = {}, onAccent = false }) => {
  return (
    <div 
      className={`logo-mark-wrap ${className}`} 
      style={{ 
        ...style, 
        width: size, 
        height: size, 
        display: 'inline-flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}
    >
      {onAccent ? (
        <img src={blackOnCyan} style={{ width: '100%', height: 'auto' }} alt="Emty" />
      ) : (
        <>
          <img src={cyanOnWhite} className="logo-img-light" style={{ width: '100%', height: 'auto' }} alt="Emty" />
          <img src={cyanOnBlack} className="logo-img-dark" style={{ width: '100%', height: 'auto' }} alt="Emty" />
        </>
      )}
    </div>
  );
};

export const LogoText: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <span
    className={className}
    style={{
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: `${size}px`,
      fontWeight: 700,
      letterSpacing: '0.05em',
      color: 'currentColor',
    }}
  >
    emty
  </span>
);

export const Logo: React.FC<LogoProps> = ({ size = 24, variant = 'icon', className = '', style = {}, onAccent = false }) => {
  if (variant === 'text') {
    return <LogoText size={size} className={className} />;
  }
  if (variant === 'full') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...style }} className={className}>
        <LogoMark size={size} onAccent={onAccent} />
        <LogoText size={size * 0.75} />
      </div>
    );
  }
  return <LogoMark size={size} className={className} style={style} onAccent={onAccent} />;
};
