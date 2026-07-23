import { useScenario } from "../hooks/useScenario";
import { appUrl } from "../lib/assetUrl";

/** Split "Lead sentence. Elaboration…" so the always-visible bar stays one
 *  line; the elaboration moves into the adjacent expander verbatim. */
function splitLeadSentence(text: string): [string, string] {
  const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text.trim());
  return match ? [match[1], match[2]] : [text, ""];
}

/**
 * Persistent product disclosure. This is intentionally not dismissible: the
 * scenario's outputs can look like public opinion, so the core limitation must
 * remain beside every map, chart, conversation, and replay surface. The bar
 * itself keeps only the lead claim at one line of height; the full core
 * notice and supporting notices live one click away in "What that means".
 */
export default function ResponsibleUseNotice() {
  const { scenario } = useScenario();
  const notice = scenario.responsible_use;
  const [lead, elaboration] = splitLeadSentence(notice.core_notice);

  return (
    <aside className="responsible-use-notice" aria-label="Simulation disclosure">
      <p className="responsible-use-notice__core">{lead}</p>
      <details className="responsible-use-notice__details">
        <summary>What that means</summary>
        <div className="responsible-use-notice__expanded">
          {elaboration && <p>{elaboration}</p>}
          <p>{notice.residents_notice}</p>
          <p>{notice.subjects_notice}</p>
          <p>{notice.outputs_notice}</p>
          <a href={appUrl("legal/RESPONSIBLE_USE.md")} target="_blank" rel="noreferrer">
            Read the responsible-use policy
          </a>
        </div>
      </details>
    </aside>
  );
}
