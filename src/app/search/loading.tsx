import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { ScrollToTop } from "~/components/ScrollToTop";
import { SearchPageShell } from "~/components/search/SearchPageShell";
import { SearchVisibilityProvider } from "~/context/SearchVisibilityContext";

export default function SearchLoading() {
  return (
    <SearchVisibilityProvider>
      <div className="bg-background flex min-h-svh flex-col">
        <Header />
        <div className="flex-1">
          <SearchPageShell />
        </div>
        <Footer />
        <ScrollToTop />
      </div>
    </SearchVisibilityProvider>
  );
}
