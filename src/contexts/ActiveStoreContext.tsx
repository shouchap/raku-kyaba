"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

type ActiveStoreContextValue = {
  activeStoreId: string;
};

const ActiveStoreContext = createContext<ActiveStoreContextValue | null>(null);

export function ActiveStoreProvider({
  children,
  activeStoreId,
}: {
  children: ReactNode;
  activeStoreId: string;
}) {
  return (
    <ActiveStoreContext.Provider value={{ activeStoreId }}>
      {children}
    </ActiveStoreContext.Provider>
  );
}

/** 管理画面内で現在選択中の店舗 ID（Cookie + フォールバックと一致） */
export function useActiveStoreId(): string {
  const ctx = useContext(ActiveStoreContext);
  if (!ctx) {
    throw new Error("useActiveStoreId must be used within ActiveStoreProvider");
  }
  return ctx.activeStoreId;
}
