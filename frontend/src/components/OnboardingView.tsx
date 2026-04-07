import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Phaser from "phaser";
import { OnboardingScene } from "../game/OnboardingScene";
import { GAME_CONFIG } from "../game/config";
import { useUserProfile } from "../context/UserProfileContext";
import type { TownId } from "../types/messages";

/* ── Progress Dots ────────────────────────────────────────── */

const STEPS = ["name", "town", "leaning", "concerns", "personality"];

function ProgressDots({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="onboarding-progress">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`onboarding-dot ${
            i < currentIndex ? "onboarding-dot--done" : i === currentIndex ? "onboarding-dot--active" : ""
          }`}
        />
      ))}
    </div>
  );
}

/* ── OnboardingView ───────────────────────────────────────── */

export default function OnboardingView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setProfile } = useUserProfile();

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<OnboardingScene | null>(null);

  const [overlay, setOverlay] = useState<{
    visible: boolean;
    step: string;
    prompt: string;
  }>({ visible: false, step: "", prompt: "" });

  const [inputValue, setInputValue] = useState("");
  const [stepIndex, setStepIndex] = useState(0);

  const preselectedTown = searchParams.get("town") as TownId | null;

  /* ── Initialize Phaser ───────────────────────────────────── */

  useEffect(() => {
    if (!gameContainerRef.current || gameRef.current) return;

    const scene = new OnboardingScene();
    sceneRef.current = scene;

    const game = new Phaser.Game({
      ...GAME_CONFIG,
      parent: gameContainerRef.current,
      scene,
    });

    game.scene.start("OnboardingScene", { preselectedTown });
    gameRef.current = game;

    // Listen for scene events
    const checkScene = setInterval(() => {
      const activeScene = game.scene.getScene("OnboardingScene") as OnboardingScene | undefined;
      if (activeScene && activeScene.scene.isActive()) {
        clearInterval(checkScene);

        activeScene.events.on("onboarding-need-input", (data: { step: string; prompt: string }) => {
          setOverlay({ visible: true, step: data.step, prompt: data.prompt });
          setInputValue("");
          setStepIndex(STEPS.indexOf(data.step));
        });

        activeScene.events.on("onboarding-complete", (profileData: any) => {
          setProfile(profileData);
          navigate(`/town/${profileData.town}`);
        });
      }
    }, 200);

    return () => {
      clearInterval(checkScene);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  /* ── Handle input submission ─────────────────────────────── */

  const handleSubmit = useCallback(() => {
    if (!inputValue.trim()) return;
    const scene = gameRef.current?.scene.getScene("OnboardingScene") as OnboardingScene | undefined;
    if (!scene) return;

    scene.receiveInput(overlay.step, inputValue.trim());
    setOverlay({ visible: false, step: "", prompt: "" });
    setInputValue("");
    setStepIndex((prev) => prev + 1);
  }, [inputValue, overlay.step]);

  return (
    <div className="onboarding-layout">
      {/* Phaser canvas */}
      <div className="onboarding-canvas" style={{ background: "#e8dcc8" }}>
        <div ref={gameContainerRef} className="absolute inset-0" />
      </div>

      {/* Frosted glass input overlay */}
      {overlay.visible && (
        <div className="onboarding-overlay-backdrop">
          <div className="onboarding-overlay">
            <ProgressDots currentIndex={stepIndex} />

            <h3 className="onboarding-overlay-title">{overlay.prompt}</h3>

            {overlay.step === "personality" ? (
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.slice(0, 200))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="e.g., I'm a teacher worried about property taxes..."
                className="onboarding-textarea"
                rows={3}
                maxLength={200}
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder={overlay.step === "name" ? "Type your name..." : ""}
                className="onboarding-input"
                autoFocus
              />
            )}

            <div className="onboarding-overlay-actions">
              {overlay.step === "personality" && (
                <span className="onboarding-char-count">{inputValue.length}/200</span>
              )}
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
                className="onboarding-submit"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
