import "./globals.css";

export const metadata = { title: "Peasily Watch", robots: { index: false, follow: false } };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
