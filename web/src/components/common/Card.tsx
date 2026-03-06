import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

export function Card({ title, children, className = "", headerRight }: CardProps) {
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-xl ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          {headerRight && <div>{headerRight}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
