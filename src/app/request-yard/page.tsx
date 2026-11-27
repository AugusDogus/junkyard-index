import { PageShell } from "~/components/PageShell";
import { RequestYardForm } from "~/components/request-yard/RequestYardForm";

// Every footer links here, so the page reads nothing from the request and
// is served from the CDN. The form fills in a signed-in visitor's email in
// the browser.
export default function RequestYardPage() {
  return (
    <PageShell rendering="static">
      <RequestYardForm />
    </PageShell>
  );
}
