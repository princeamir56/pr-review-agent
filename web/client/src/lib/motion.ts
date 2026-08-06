import type { Transition } from "framer-motion";

export const T = {
  micro: { duration: 0.16, ease: [0.2, 0, 0.2, 1] },
  soft: { duration: 0.24, ease: [0.2, 0, 0.2, 1] },
  page: { duration: 0.32, ease: [0.2, 0, 0.2, 1] },
  spring: { type: "spring", stiffness: 320, damping: 30 }
} satisfies Record<string, Transition>;

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 }
};

export const stagger = (children = 0.04) => ({
  animate: { transition: { staggerChildren: children } }
});
