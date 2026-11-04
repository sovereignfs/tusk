import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@sovereignfs/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = { title: 'Tasks' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
