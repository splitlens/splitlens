/**
 * /review layout — wraps both sub-routes (/category and /split) with a
 * shared sub-nav at the top so the user can flip between the two review
 * jobs without losing context.
 *
 * Server-side wrapper that delegates the active-tab highlighting to a
 * tiny <ReviewSubNav> client component (it needs usePathname).
 */
import type { ReactNode } from "react";
import { ReviewSubNav } from "@/components/review/ReviewSubNav";

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ReviewSubNav />
      {children}
    </>
  );
}
