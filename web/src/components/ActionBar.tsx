import { useNavigate } from "react-router-dom";
import { plural, seedLines } from "../lib/format";
import { exportCsv, exportRis } from "../lib/export";
import { useSession } from "../lib/session";
import { RefreshIcon, StarIcon } from "./Icons";
import { useToast } from "./Toast";

/** The review loop's two exits, floating over the results: the shortlist you are building, and a re-run once
 *  you have added seeds or changed the question. `baseline` is the search the results on screen came from. */
export function ActionBar({ baseline, running }: { baseline: { question: string; seeds: string[] }; running: boolean }) {
  const { form, start, kept, clearKept } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const keptList = Object.values(kept);

  const was = new Set(baseline.seeds.map((s) => s.toLowerCase()));
  const now = seedLines(form.seeds);
  const added = now.filter((s) => !was.has(s.toLowerCase())).length;
  const removed = baseline.seeds.length - now.filter((s) => was.has(s.toLowerCase())).length;
  const changed = added > 0 || removed > 0 || form.question.trim() !== baseline.question.trim();

  if (!keptList.length && (!changed || running)) return null;
  const rerunLabel = added ? `Run again with ${plural(added, "new seed")}` : "Run again with your changes";

  return (
    <div className="action-bar" role="region" aria-label="Shortlist and re-run">
      {keptList.length > 0 && (
        <div className="ab-group">
          <span className="ab-count"><StarIcon filled />{plural(keptList.length, "paper")} kept</span>
          <button type="button" className="btn utility sm" onClick={() => { exportRis(keptList, "shortlist.ris"); toast("Exported your shortlist as RIS."); }}>RIS</button>
          <button type="button" className="btn utility sm" onClick={() => { exportCsv(keptList, () => "", "shortlist.csv"); toast("Exported your shortlist as CSV."); }}>CSV</button>
          <button type="button" className="link" onClick={() => { clearKept(); toast("Shortlist cleared."); }}>Clear</button>
        </div>
      )}
      {changed && !running && (
        <button type="button" className="btn primary sm" onClick={() => {
          const problem = start();
          if (problem) toast(problem);
          else { navigate("/search"); window.scrollTo({ top: 0, behavior: "smooth" }); }
        }}><RefreshIcon />{rerunLabel}</button>
      )}
    </div>
  );
}
