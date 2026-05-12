import { useState, type ReactNode } from "react";

const STORAGE_KEY = "township-tutorial-seen";

interface TutorialProps {
  /** Force-show (testing); ignores localStorage. */
  forceShow?: boolean;
  onDismiss?: () => void;
}

/* ── Inline SVG icons (no emojis) ─────────────────────────── */

function IconKeyboard(): ReactNode {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="9" width="26" height="16" rx="2.5" />
      <line x1="9" y1="14" x2="9.01" y2="14" />
      <line x1="13" y1="14" x2="13.01" y2="14" />
      <line x1="17" y1="14" x2="17.01" y2="14" />
      <line x1="21" y1="14" x2="21.01" y2="14" />
      <line x1="25" y1="14" x2="25.01" y2="14" />
      <line x1="9" y1="20" x2="25" y2="20" />
    </svg>
  );
}

function IconChat(): ReactNode {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M28 19.5a2.5 2.5 0 0 1-2.5 2.5H12l-5 5V8.5A2.5 2.5 0 0 1 9.5 6h16A2.5 2.5 0 0 1 28 8.5v11z" />
    </svg>
  );
}

function IconPalette(): ReactNode {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="17" cy="17" r="13" />
      <circle cx="11" cy="14" r="1.6" fill="currentColor" />
      <circle cx="17" cy="11" r="1.6" fill="currentColor" />
      <circle cx="23" cy="14" r="1.6" fill="currentColor" />
      <circle cx="22" cy="20" r="1.6" fill="currentColor" />
      <path d="M17 28c-2 0-3-1.5-2-3 1.2-1.8 0-3 1.5-3 2.5 0 3-2 3.5-2" />
    </svg>
  );
}

const STEPS: Array<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: "Move with WASD",
    body: "Use W A S D or the arrow keys to walk around the town.",
    icon: <IconKeyboard />,
  },
  {
    title: "Talk to neighbors",
    body: "Press E or click any NPC to start a conversation.",
    icon: <IconChat />,
  },
  {
    title: "Read the opinion ring",
    body: "The colored ring around each agent shows who they support — blue for Mejia, orange for Hathaway.",
    icon: <IconPalette />,
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
