import type { Metadata, Viewport } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Archivo's width axis drives the expanded display style, so it has to be loaded explicitly.
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://rallyautocare.us'),
  title: { default: 'Rally Auto Care — Mobile detailing in Northern Virginia', template: '%s · Rally Auto Care' },
  description:
    'Mobile car detailing in Northern Virginia and the DMV. We bring the water, power and gear to your driveway or office. Book a one-time detail or a monthly membership.',
  openGraph: { title: 'Rally Auto Care', description: 'Detailing that comes to you. Northern Virginia & DMV.', type: 'website' },
};

export const viewport: Viewport = { themeColor: '#0D0D0E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
