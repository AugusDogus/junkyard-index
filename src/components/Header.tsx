import { headers } from "next/headers";
import { auth } from "~/lib/auth";
import { HeaderContent } from "./HeaderContent";

export async function Header() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return <HeaderContent user={session?.user ?? null} />;
}
