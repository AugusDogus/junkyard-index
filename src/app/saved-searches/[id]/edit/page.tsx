import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "~/lib/auth";
import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { PageShell } from "~/components/PageShell";
import { SavedSearchEditorPage } from "~/components/search/editor/SavedSearchEditorPage";
import { getHiddenSources } from "~/server/source-control/hidden-sources-loader";
export const metadata = {
  title: "Edit saved search",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user)
    redirect(
      `/auth/sign-in?returnTo=${encodeURIComponent(`/saved-searches/${encodeURIComponent(id)}/edit`)}`,
    );
  return (
    <PageShell width="workspace">
      {/* The source picker offers only sources shown on the site. */}
      <HiddenSourcesProvider hidden={await getHiddenSources()}>
        <SavedSearchEditorPage id={id} />
      </HiddenSourcesProvider>
    </PageShell>
  );
}
