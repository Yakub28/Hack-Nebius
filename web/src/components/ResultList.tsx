import { useEffect, useLayoutEffect, useRef } from "react";
import type { Discovery, Result } from "../api/types";
import { ResultCard } from "./ResultCard";

/** Cards slide to their new place when the order changes, as grades stream in: the eye can follow a paper
 *  rising instead of the list jumping. (FLIP: measure, re-render, play the difference.) Cards that arrive
 *  together cascade in, a beat apart, rather than landing as one block. */
function useSlide() {
  const nodes = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let arriving = 0;
    nodes.current.forEach((el, id) => {
      const top = el.offsetTop;
      const was = before.current.get(id);
      if (was == null) el.animate?.([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
        { duration: still ? 0 : 280, delay: still ? 0 : Math.min(arriving++, 8) * 35, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" });
      else if (!still && Math.abs(was - top) > 1) {
        el.animate?.([{ transform: `translateY(${was - top}px)` }, { transform: "none" }],
          { duration: 480, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
      before.current.set(id, top);
    });
  });
  return (id: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else { nodes.current.delete(id); before.current.delete(id); }
  };
}

export function ResultList({ list, data, live, byRelevance, selected, cursor, isNew, showRelevance, onOpen, onClear }: {
  list: Result[]; data: Discovery; live: boolean; byRelevance: boolean; selected: string | null; cursor: string | null;
  isNew: (id: string) => boolean; showRelevance: boolean; onOpen: (id: string) => void; onClear: () => void;
}) {
  const slot = useSlide();
  // Keyboard moves keep the cursor in view; scroll-margin on the cards clears the sticky toolbar.
  useEffect(() => {
    if (cursor) document.getElementById(`r-${cursor}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursor]);
  if (!list.length) {
    return (
      <div className="none">No results match these filters.{" "}
        <button type="button" className="link" onClick={onClear}>Clear filters</button>
      </div>
    );
  }
  const cut = byRelevance && data.cutoff != null ? list.findIndex((r) => !r.likely_relevant) : -1;
  return (
    <ol className="cards">
      {list.map((r, i) => (
        <li key={r.id} id={`r-${r.id}`} ref={slot(r.id)}>
          {i === cut && (
            <div className="cutline">{i === 0 ? "No result reached your seeds' grade"
              : `Below this line: graded lower than your weakest seed (${data.cutoff})`}</div>
          )}
          <ResultCard r={r} data={data} live={live} selected={r.id === selected} cursor={r.id === cursor && r.id !== selected}
            below={data.cutoff != null && !live && !r.likely_relevant} isNew={isNew(r.id)} showRelevance={showRelevance} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}
