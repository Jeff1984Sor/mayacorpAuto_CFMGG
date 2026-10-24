"use client";

import { Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/** Avião de papel decolando (feedback de envio). */
export function AviaoDecolando({ ativo }: { ativo: boolean }) {
  return (
    <AnimatePresence>
      {ativo && (
        <motion.div className="pointer-events-none absolute inset-0 z-50 overflow-hidden" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="absolute inset-0 bg-brand/8 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, times: [0, 0.3, 1] }}
          />
          <motion.span
            className="absolute right-10 bottom-8 grid size-12 place-items-center rounded-2xl brand-gradient text-white shadow-2xl shadow-brand/40"
            initial={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
            animate={{ x: [0, -12, 260], y: [0, 6, -520], rotate: [0, -12, 18], scale: [1, 1.08, 0.5], opacity: [1, 1, 0] }}
            transition={{ duration: 1, times: [0, 0.18, 1], ease: [0.5, 0, 0.75, 0] }}
          >
            <Send className="size-6" />
          </motion.span>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute right-[3.6rem] bottom-12 h-0.5 w-10 rounded-full bg-brand/50"
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{ opacity: [0, 0.8, 0], x: [0, 120 + i * 30], y: [0, -260 - i * 40] }}
              transition={{ duration: 0.8, delay: 0.12 + i * 0.06 }}
              style={{ rotate: -60 }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
