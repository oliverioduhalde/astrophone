import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, UnifrakturMaguntia } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });
// [T-63] Instalación: tipografía gótica (blackletter) para el anillo de
// texto inicial. Expuesta como variable CSS para usarla puntual, sin
// pisar el font-mono del resto de la app.
const _gothic = UnifrakturMaguntia({ subsets: ["latin"], weight: "400", variable: "--font-gothic" });

export const metadata: Metadata = {
  title: 'ASTRO.LOG.IO',
  description: 'ASTRO.LOG.IO',
  applicationName: 'ASTRO.LOG.IO',
  generator: 'v0.app',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ASTRO.LOG.IO',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans antialiased bg-black text-white ${_gothic.variable}`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
