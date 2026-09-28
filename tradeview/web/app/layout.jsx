// Root layout (§14): html/body, metadata, PWA manifest, global CSS.
import '../src/styles/app.css';

export const metadata = {
  title: 'TradeView',
  description: 'Self-hosted charting with Delta Exchange and Bybit data, Pine Script, Laya-gated alerts and a Claude trading agent.',
  applicationName: 'TradeView',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  appleWebApp: { capable: true, title: 'TradeView', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#131722',
  colorScheme: 'dark',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
