"use client";

import { Menu } from "lucide-react";

/** Opens the sidebar as a slide-over drawer on small screens. Hidden from lg up,
 *  where the sidebar is always on screen. */
export default function NavToggle() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("wb-erp:toggle-nav"))}
      className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-line/60 lg:hidden"
      title="Menu"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
