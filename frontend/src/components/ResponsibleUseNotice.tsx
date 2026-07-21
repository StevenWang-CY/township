import { useScenario } from "../hooks/useScenario";
import { appUrl } from "../lib/assetUrl";

/**
 * Persistent product disclosure. This is intentionally not dismissible: the
 * scenario's outputs can look like public opinion, so the core limitation must
 * remain beside every map, chart, conversation, and replay surface.
 */
export default function ResponsibleUseNotice() {
  const { scenario } = useScenario();
  const notice = scenario.responsible_use;

  return (
    <aside className="responsible-use-notice" aria-label="Simulation disclosure">
      <p className="responsible-use-notice__core">{notice.core_notice}</p>
      <details className="responsible-use-notice__details">
        <summary>What that means</summary>
        <div className="responsible-use-notice__expanded">
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
