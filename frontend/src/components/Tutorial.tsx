import { useState } from "react";

const STORAGE_KEY = "township-tutorial-seen";

interface TutorialProps {
  /** Force-show (testing); ignores localStorage. */
  forceShow?: boolean;
  onDismiss?: () => void;
}

const STEPS = [
  {
    title: "Move with WASD",
    body: "Use W A S D or the arrow keys to walk around the town.",
    icon: "🎮",
  },
  {
    title: "Talk to neighbors",
    body: "Press E or click any NPC to start a conversation.",
    icon: "💬",
  },
  {
    title: "Read the opinion ring",
    body: "The colored ring around each agent shows who they support — blue for Mejia, orange for Hathaway.",
    icon: "🎨",
  },
];

export default function Tutorial({ forceShow = false, onDismiss }: TutorialProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (forceShow) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [step, setStep] = useState(0);

  if (!open) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
    onDismiss?.();
  };

  const next = () => {
    if (step >= STEPS.length - 1) dismiss();
    else setStep((s) => s + 1);
  };

  const current = STEPS[step];

  return (
    <div className="tutorial-backdrop" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="tutorial-modal">
        <div className="tutorial-modal-icon">{current.icon}</div>
        <h3 id="tutorial-title" className="tutorial-modal-title">{current.title}</h3>
        <p className="tutorial-modal-body">{current.body}</p>

        <div className="tutorial-modal-dots">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`tutorial-dot ${i === step ? "tutorial-dot--active" : ""}`}
            />
          ))}
        </div>

        <div className="tutorial-modal-actions">
          <button onClick={dismiss} className="tutorial-skip">Skip</button>
          <button onClick={next} className="tutorial-next">
            {step >= STEPS.length - 1 ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
