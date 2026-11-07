// A bottom-sheet-on-mobile, centered-modal-on-desktop pattern.
// Soft fade in. No backdrop blur (we already have one on the topbar).

import { ReactNode, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";

export function Modal({
  title, onClose, children,
}: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{ background: "color-mix(in oklab, var(--ink) 28%, transparent)" }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      >
        <motion.div
          key="sheet"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="card-paper w-full sm:max-w-md rounded-t-md sm:rounded-md mx-0 sm:mx-4 p-5 sm:p-6 safe-bot"
          style={{ maxHeight: "92dvh", overflowY: "auto" }}
        >
          {title && (
            <h2 className="font-serif text-xl lowercase tracking-wide mb-4">{title}</h2>
          )}
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
