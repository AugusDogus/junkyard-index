import type { ReactNode } from "react";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";

const WIDTH_CLASSES = {
  narrow: "max-w-xl",
  wide: "max-w-3xl",
  workspace: "max-w-6xl",
} as const;

export function PageShell({
  children,
  width = "narrow",
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH_CLASSES;
}) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />
      <main
        className={`mx-auto w-full flex-1 px-4 py-12 sm:px-6 lg:px-8 ${WIDTH_CLASSES[width]}`}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
