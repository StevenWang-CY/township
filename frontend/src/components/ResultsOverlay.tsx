/* ── ResultsOverlay ──────────────────────────────────────────
 * The results moment over the town: who won, by how much, town by town,
 * and the residents who moved. Sits inside the canvas frame (the bunting
 * world stays visible around it) and dismisses back to the town.
 * ─────────────────────────────────────────────────────────── */

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useScenario } from "../hooks/useScenario";
import { readableInk } from "../lib/color";
import type { RunResults } from "../lib/election";
import BallotBar from "./charts/BallotBar";
import Icon from "./Icon";

interface ResultsOverlayProps {
  results: RunResults;
  townId: string;
  onDismiss: () => void;
}

export default function ResultsOverlay({ results, townId, onDismiss }: ResultsOverlayProps) {
  const scen = useScenario();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  const winner = results.winner;
  const winnerLabel = winner ? scen.optionName(winner) : null;
  const here = results.towns.find((t) => t.town === townId);
  const election = scen.decisionKind === "election";
  const noun = scen.optionNoun(false);
  const tie = !winner;
  const headline = tie
    ? `No ${noun} carried the ${election ? "district" : "vote"}`
    : `${winnerLabel} ${election ? "wins" : "carries"} ${scen.title}`;

  return (
    <div className="results-overlay" role="dialog" aria-modal="false" aria-labelledby="results-title">
      <div className="results-card pixel-frame">
        <button ref={closeRef} type="button" className="results-close" onClick={onDismiss} aria-label="Back to the town">
          <Icon name="close" size={16} />
        </button>
        <p className="results-kicker">
          <Icon name="ballot" size={14} /> {election ? "The district has decided" : "The town has decided"}
        </p>
        <h2 id="results-title" className="results-headline" style={winner ? { color: readableInk(scen.optionColor(winner), 5) } : undefined}>
          {headline}
        </h2>
        <p className="results-sub">
          {results.source === "election" && results.district.turnout != null ? (
            <>
              {results.district.eligible ?? results.district.total} residents · turnout {Math.round(results.district.turnout * 100)}%
              {(results.district.abstained ?? 0) > 0 && ` · ${results.district.abstained} abstained`}
            </>
          ) : (
            <>{results.district.total} residents · {results.district.undecided} still undecided</>
          )}
          {!tie && results.district.margin > 0 && ` · margin ${results.district.margin} (${Math.round(results.district.marginPct * 100)}%)`}
        </p>
        <BallotBar counts={results.district.counts} />

        {results.towns.length > 1 && (
          <ul className="results-towns" aria-label="Results by town">
            {results.towns.map((t) => {
              const meta = scen.townMeta(t.town);
              return (
                <li key={t.town} className={`results-town${t.town === townId ? " results-town--here" : ""}`}>
                  <span className="results-town-name">
                    <span className="results-town-dot" style={{ background: meta.color }} aria-hidden="true" />
                    {meta.name}
                  </span>
                  <BallotBar counts={t.counts} compact />
                  <span className="results-town-margin">
                    {t.winner ? `${scen.optionLabel(t.winner)} +${t.margin}` : "tied"}
                    {t.turnout != null && t.mode === "ballots" && (
                      <span className="results-town-turnout"> · {Math.round(t.turnout * 100)}% voted</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {results.swing.length > 0 && (
          <div className="results-swing">
            <p className="results-swing-title">Who moved</p>
            <ul>
              {results.swing.slice(0, 6).map((s) => (
                <li key={s.agentId} className="results-swing-row">
                  <strong>{s.name}</strong>
                  <span className="results-swing-town">{scen.townMeta(s.town).name}</span>
                  <span className="results-swing-path">
                    <span style={{ color: readableInk(scen.optionColor(s.from), 5) }}>{scen.optionLabel(s.from)}</span>
                    <Icon name="arrow-right" size={12} />
                    <span style={{ color: readableInk(scen.optionColor(s.to), 5) }}>{scen.optionLabel(s.to)}</span>
                    <span className="results-swing-round">r{s.round}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="results-actions">
          <button type="button" className="results-btn results-btn--primary" onClick={onDismiss}>
            {here ? `See ${scen.townMeta(townId).name}` : "Back to the town"}
          </button>
          <Link className="results-btn" to="/dashboard">Open the dashboard <Icon name="arrow-right" size={13} /></Link>
        </div>
      </div>
    </div>
  );
}
