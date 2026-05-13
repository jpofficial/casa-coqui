'use client';
import { motion, useReducedMotion } from 'framer-motion';

export default function MotionReveal({ children, index = 0 }) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div style={{ opacity: 1 }}>{children}</div>;
  }

  const delay = Math.max(0, index) * 0.08;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
