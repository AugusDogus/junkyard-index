"use client";

import { useEffect } from "react";
import { useSession } from "~/lib/auth-client";

/** Reports the signed-in visitor's email once the session loads. */
export function SessionEmail({
  onEmail,
}: {
  onEmail: (email: string) => void;
}) {
  const email = useSession().data?.user.email;
  useEffect(() => {
    if (email) onEmail(email);
  }, [email, onEmail]);
  return null;
}
