import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * React Router keeps the window scroll offset across navigations, so following a
 * link from halfway down a long page lands you halfway down the next one. Reset
 * to the top on every PUSH/REPLACE, but leave POP (back/forward) alone — there
 * the browser's restored offset is what the user expects.
 */
export function ScrollToTop(): null {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") return;
    // Jump rather than smooth-scroll: the outgoing page is already unmounted, so
    // an animated scroll would just be a flicker over the new content.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, navigationType]);

  return null;
}
