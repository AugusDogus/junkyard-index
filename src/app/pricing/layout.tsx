import type { ReactNode } from "react";
import { AppProviders } from "~/components/AppProviders";

export default function Layout({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
