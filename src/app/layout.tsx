import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { PRODUCT } from '@/lib/constants';
import { appUrl } from '@/lib/env';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { MotionProvider } from '@/components/layout/motion-provider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-stack',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: `${PRODUCT.name} — AI Software Health Auditor`,
    template: `%s · ${PRODUCT.name}`,
  },
  description:
    'Paste a GitHub repository. Sentinel deploys a team of specialised AI agents alongside deterministic security tooling, makes them challenge each other, and returns a validated software health report with a plan you can act on.',
  applicationName: PRODUCT.name,
  keywords: [
    'code audit',
    'security scanning',
    'static analysis',
    'AI code review',
    'software health',
    'SAST',
    'dependency vulnerabilities',
    'technical debt',
  ],
  openGraph: {
    type: 'website',
    siteName: PRODUCT.name,
    title: `${PRODUCT.name} — AI Software Health Auditor`,
    description: PRODUCT.tagline,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PRODUCT.name} — AI Software Health Auditor`,
    description: PRODUCT.tagline,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#08090b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {/* Keyboard users should not have to tab through the nav on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--color-canvas)]"
        >
          Skip to content
        </a>
        <MotionProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </MotionProvider>
      </body>
    </html>
  );
}
