import { useCallback, useRef, useState } from "react";

export interface ToastState {
  msg: string;
  kind: "ok" | "bad" | "info";
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string, kind: ToastState["kind"] = "info") => {
    setToast({ msg, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const node = toast ? (
    <div className={`toast ${toast.kind === "ok" ? "ok" : toast.kind === "bad" ? "bad" : ""}`}>
      {toast.msg}
    </div>
  ) : null;

  return { show, toastNode: node };
}
