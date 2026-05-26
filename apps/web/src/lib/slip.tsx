'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Outcome, OrderSide } from './types';

export interface SlipLeg {
  marketId: string;
  marketLabel: string; // short human label, e.g. "Yankees ML"
  outcome: Outcome;
  side: OrderSide;
  price: number;
  quantity: number;
}

interface SlipContextValue {
  leg: SlipLeg | null;
  open: boolean;
  setLeg: (leg: SlipLeg | null) => void;
  patchLeg: (patch: Partial<SlipLeg>) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
}

const SlipContext = createContext<SlipContextValue | null>(null);

export function SlipProvider({ children }: { children: ReactNode }): JSX.Element {
  const [leg, setLegState] = useState<SlipLeg | null>(null);
  const [open, setOpen] = useState(false);

  const setLeg = useCallback((next: SlipLeg | null) => {
    setLegState(next);
    if (next) setOpen(true);
  }, []);

  const patchLeg = useCallback((patch: Partial<SlipLeg>) => {
    setLegState((curr) => (curr ? { ...curr, ...patch } : curr));
  }, []);

  const clear = useCallback(() => {
    setLegState(null);
    setOpen(false);
  }, []);

  const value = useMemo<SlipContextValue>(
    () => ({ leg, open, setLeg, patchLeg, clear, setOpen }),
    [leg, open, setLeg, patchLeg, clear],
  );

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip(): SlipContextValue {
  const ctx = useContext(SlipContext);
  if (!ctx) throw new Error('useSlip must be used within SlipProvider');
  return ctx;
}
