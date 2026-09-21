import type { AgentState } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import SpritePortrait from "./SpritePortrait";

interface LandmarkCardProps {
  name: string;
  /** Town accent for speaker names. */
  accent: string;
  /** Residents inside or at the door right now. */
  residents: AgentState[];
  /** Recent lines spoken at this place. */
  lines: Array<{ agent_id: string; agent_name: string; text: string }>;
  onClose: () => void;
  /** Start talking to one of the residents here. */
  onTalk?: (agentId: string) => void;
}

/**
 * The visit card — what you get for pressing E at a door with nobody in
 * talk range: who is here and what has been said here. Every resident chip
 * is a next step (click to talk), so the card never dead-ends.
 */
export default function LandmarkCard({
  name,
  accent,
  residents,
  lines,
  onClose,
  onTalk,
}: LandmarkCardProps) {
  const { optionColor, undecidedId } = useScenario();
  const count = residents.length;
  return (
    <div className="listen-in-panel landmark-card" role="dialog" aria-label={name}>
      <div className="listen-in-panel-header">
        <div>
          <strong>{name}</strong>
          <span className="landmark-card-sub">
            {count === 0 ? "Nobody here right now" : count === 1 ? "1 resident here" : `${count} residents here`}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label={`Close ${name}`}>×</button>
      </div>
      {count > 0 && (
        <div className="landmark-card-people">
          {residents.map((a) => (
            <button
              key={a.id}
              type="button"
              className="landmark-card-person"
              onClick={() => onTalk?.(a.id)}
              title={`Talk to ${a.name}`}
            >
              <SpritePortrait
                agentId={a.id}
                spriteKey={a.sprite_key}
                accessoryKey={a.accessory_key}
                fallbackInitials={a.initials}
                color={a.color || accent}
                size={22}
                ringColor={optionColor(a.opinion?.candidate ?? undecidedId)}
              />
              <span>{a.name.split(/[\s"'&]/)[0]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="listen-in-panel-body">
        {lines.length === 0 ? (
          <p className="landmark-card-quiet">Quiet right now. Stick around — voices will catch up here.</p>
        ) : (
          lines.map((e, i) => (
            <p key={i} className="listen-in-line">
              <strong style={{ color: accent }}>{e.agent_name}:</strong> {e.text}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
