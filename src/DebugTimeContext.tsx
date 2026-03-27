import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export type DebugTimeContextValue = {
  /** 仮想現在時刻（実時刻 + timeOffsetMs） */
  getNow: () => Date;
  timeOffsetMs: number;
  setTimeOffsetMs: (ms: number) => void;
  debugNightCareMultiplier: number | null;
  setDebugNightCareMultiplier: (v: number | null) => void;
  resetAllDebugSettings: () => void;
};

const noop = () => {};

const productionValue: DebugTimeContextValue = {
  getNow: () => new Date(),
  timeOffsetMs: 0,
  setTimeOffsetMs: noop,
  debugNightCareMultiplier: null,
  setDebugNightCareMultiplier: noop,
  resetAllDebugSettings: noop,
};

const DebugTimeContext = createContext<DebugTimeContextValue>(productionValue);

export function useDebugTime(): DebugTimeContextValue {
  return useContext(DebugTimeContext);
}

const IS_DEV_ENV = process.env.NODE_ENV === 'development';

/**
 * development のときだけ仮想時刻・夜倍率を保持。それ以外は常に productionValue。
 */
export function DebugTimeProvider({ children }: { children: React.ReactNode }) {
  const [timeOffsetMs, setTimeOffsetMs] = useState(0);
  const [debugNightCareMultiplier, setDebugNightCareMultiplier] = useState<number | null>(
    null
  );

  const getNow = useCallback(() => {
    if (!IS_DEV_ENV) return new Date();
    return new Date(Date.now() + timeOffsetMs);
  }, [timeOffsetMs]);

  const resetAllDebugSettings = useCallback(() => {
    setTimeOffsetMs(0);
    setDebugNightCareMultiplier(null);
  }, []);

  const value = useMemo<DebugTimeContextValue>(() => {
    if (!IS_DEV_ENV) {
      return productionValue;
    }
    return {
      getNow,
      timeOffsetMs,
      setTimeOffsetMs,
      debugNightCareMultiplier,
      setDebugNightCareMultiplier,
      resetAllDebugSettings,
    };
  }, [
    getNow,
    timeOffsetMs,
    debugNightCareMultiplier,
    resetAllDebugSettings,
  ]);

  return (
    <DebugTimeContext.Provider value={value}>{children}</DebugTimeContext.Provider>
  );
}
