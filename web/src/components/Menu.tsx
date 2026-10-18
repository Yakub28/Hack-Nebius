import { useEffect, useRef, type ReactNode } from "react";
import { ChevronIcon } from "./Icons";

/** A button that opens a small panel below it. Built on <details>, so it works with the keyboard and screen
 *  readers as is; a click outside or Escape closes it. */
export function Menu({ label, icon, badge, align = "left", children }: {
  label: string; icon?: ReactNode; badge?: number; align?: "left" | "right"; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className={`btn utility sm${badge ? " active" : ""}`}>
        {icon}{label}{badge ? <span className="menu-badge">{badge}</span> : null}<ChevronIcon />
      </summary>
      <div className={`menu-panel ${align}`}>{children}</div>
    </details>
  );
}
