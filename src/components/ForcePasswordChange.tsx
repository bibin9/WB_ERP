"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** If the user must reset their password, keep them on /account until they do. */
export default function ForcePasswordChange({ active }: { active: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (active && pathname !== "/account") router.replace("/account?forceChange=1");
  }, [active, pathname, router]);
  return null;
}
