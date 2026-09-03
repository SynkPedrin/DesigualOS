import type { Metadata } from 'next';
import {
  Big_Shoulders,
  Bricolage_Grotesque,
  Instrument_Serif,
  JetBrains_Mono,
  Work_Sans,
} from 'next/font/google';
import '@/styles/tokens.css';
import { AuthProvider } from './auth-provider';
import { MswProvider } from './msw-provider';
import { QueryProvider } from './query-provider';
import { ThemeProvider } from './theme-provider';

// Google Fonts merged "Big Shoulders Display" into the variable "Big Shoulders" family
// (width/weight axis covers what used to be the separate Display cut).
const bigShoulders = Big_Shoulders({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-big-shoulders',
  display: 'swap',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-bricolage',
  display: 'swap',
});

const workSans = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-work-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'desigual OS',
  description: 'O sistema operacional de IA da Desigual.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${bigShoulders.variable} ${bricolage.variable} ${workSans.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <QueryProvider>
          <MswProvider>
            <AuthProvider>
              <ThemeProvider>{children}</ThemeProvider>
            </AuthProvider>
          </MswProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
