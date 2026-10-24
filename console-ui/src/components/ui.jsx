import React from 'react';

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Banner({ kind = 'ok', children }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function StatusDot({ ok }) {
  return <span className={`dot ${ok ? 'green' : 'red'}`} />;
}

export function PageHeader({ title, children }) {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      <div className="page-header-actions">{children}</div>
    </div>
  );
}

export function Tag({ kind, children }) {
  return <span className={`tag ${kind}`}>{children}</span>;
}
