import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Phaser from "phaser";
import {
  OnboardingScene,
  type OnboardingStanceInfo,
  type OnboardingTownInfo,
} from "../game/OnboardingScene";
import { GAME_CONFIG } from "../game/config";
import { useUserProfile } from "../context/UserProfileContext";
import { useScenario } from "../hooks/useScenario";
import type { TownId } from "../types/messages";

const AVATARS = [1, 2, 3, 4, 5, 6] as const;
const OUTFITS = [
  { id: "casual", label: "Everyday" },
  { id: "business", label: "Professional" },
  { id: "labor", label: "Workwear" },
  { id: "parent", label: "Weekend" },
] as const;

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "TR";
}

function idFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `player-${slug || "resident"}`;
}

/**
 * A semantic onboarding form backed by the active scenario package.
 *
 * Phaser remains as atmospheric art, while every required choice lives in
 * native HTML controls so keyboard and assistive-technology users can finish
 * the same flow without interacting with a canvas.
 */
export default function OnboardingView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setProfile } = useUserProfile();
  const scen = useScenario();
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const requestedTown = searchParams.get("town");
  const initialTown = scen.scenario.towns.some((town) => town.id === requestedTown)
    ? requestedTown as TownId
    : scen.scenario.towns[0].id;

  const [name, setName] = useState("");
  const [town, setTown] = useState<TownId>(initialTown);
  const [stance, setStance] = useState(scen.undecidedId);
  const [concerns, setConcerns] = useState("");
  const [perspective, setPerspective] = useState("");
  const [avatar, setAvatar] = useState<(typeof AVATARS)[number]>(1);
  const [outfit, setOutfit] = useState<(typeof OUTFITS)[number]["id"]>("casual");

  const towns = useMemo<OnboardingTownInfo[]>(() => (
    scen.scenario.towns.map((item) => {
      const meta = scen.townMeta(item.id);
      return {
        id: item.id,
        name: meta.name,
        tagline: meta.tagline,
        color: meta.color,
        population: meta.population,
        mapPath: meta.map?.path,
      };
    })
  ), [scen]);

  const stances = useMemo<OnboardingStanceInfo[]>(() => ([
    ...scen.scenario.options.map((option) => ({
      id: option.id,
      label: option.name || option.label,
      color: option.color,
    })),
    {
      id: scen.scenario.undecided.id,
      label: scen.scenario.undecided.label,
      color: scen.scenario.undecided.color,
    },
  ]), [scen]);

  useEffect(() => {
    if (!gameContainerRef.current || gameRef.current) return;

    const scene = new OnboardingScene();
    const game = new Phaser.Game({
      ...GAME_CONFIG,
      parent: gameContainerRef.current,
      scene,
    });
    game.scene.start("OnboardingScene", {
      preselectedTown: initialTown,
      towns,
      stances,
      decorative: true,
    });
    gameRef.current = game;

    return () => {
      gameRef.current = null;
      game.destroy(true);
    };
  }, [initialTown, stances, towns]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    const topConcerns = concerns
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);
    const townMeta = scen.townMeta(town);

    await setProfile({
      name: cleanName,
      town,
      politicalLeaning: stance,
      topConcerns,
      personality: perspective.trim(),
      initials: initialsFor(cleanName),
      color: townMeta.color,
      agentId: idFor(cleanName),
      spriteKey: `char-player-${avatar}`,
      outfitKey: outfit,
    });
    navigate(`/town/${town}`);
  };

  return (
    <main className="onboarding-layout">
      <section className="onboarding-art" aria-hidden="true">
        <div ref={gameContainerRef} className="onboarding-canvas" />
        <div className="onboarding-art-caption">
          <span className="onboarding-art-kicker">A living civic simulation</span>
          <strong>Arrive as yourself. Listen as a neighbor.</strong>
        </div>
      </section>

      <section className="onboarding-form-panel" aria-labelledby="onboarding-title">
        <form className="onboarding-form" onSubmit={submit}>
          <div className="onboarding-form-heading">
            <span className="onboarding-eyebrow">Create a local resident</span>
            <h1 id="onboarding-title">Join the town square</h1>
            <p>
              Choose how you enter this scenario. You can revise your perspective as
              you hear from residents; no answer is treated as a real-world poll response.
            </p>
          </div>

          <label className="onboarding-field" htmlFor="resident-name">
            <span>Your name</span>
            <input
              id="resident-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>

          <fieldset className="onboarding-fieldset">
            <legend>Choose your town</legend>
            <div className="onboarding-choice-grid onboarding-choice-grid--towns">
              {towns.map((item) => (
                <label className="onboarding-choice" key={item.id}>
                  <input
                    type="radio"
                    name="town"
                    value={item.id}
                    checked={town === item.id}
                    onChange={() => setTown(item.id)}
                  />
                  <span className="onboarding-choice-card">
                    <i style={{ background: item.color }} aria-hidden="true" />
                    <strong>{item.name}</strong>
                    {item.tagline && <small>{item.tagline}</small>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="onboarding-fieldset">
            <legend>Where are you starting?</legend>
            <p className="onboarding-field-hint">
              This uses the choices defined by “{scen.question}” — it is not party registration.
            </p>
            <div className="onboarding-choice-grid">
              {stances.map((item) => (
                <label className="onboarding-choice" key={item.id}>
                  <input
                    type="radio"
                    name="stance"
                    value={item.id}
                    checked={stance === item.id}
                    onChange={() => setStance(item.id)}
                  />
                  <span className="onboarding-choice-card onboarding-choice-card--compact">
                    <i style={{ background: item.color }} aria-hidden="true" />
                    <strong>{item.label}</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="onboarding-personalize-grid">
            <fieldset className="onboarding-fieldset">
              <legend>Portrait</legend>
              <div className="onboarding-avatar-grid">
                {AVATARS.map((item) => (
                  <label className="onboarding-avatar-choice" key={item}>
                    <input
                      type="radio"
                      name="avatar"
                      value={item}
                      checked={avatar === item}
                      onChange={() => setAvatar(item)}
                    />
                    <span aria-hidden="true">{item}</span>
                    <b>Portrait {item}</b>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="onboarding-field" htmlFor="resident-outfit">
              <span>Outfit</span>
              <select
                id="resident-outfit"
                value={outfit}
                onChange={(event) => setOutfit(event.target.value as typeof outfit)}
              >
                {OUTFITS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="onboarding-field" htmlFor="resident-concerns">
            <span>What do you care about?</span>
            <small>Optional · separate up to six topics with commas</small>
            <input
              id="resident-concerns"
              value={concerns}
              onChange={(event) => setConcerns(event.target.value)}
              placeholder="Transit, schools, small businesses"
              maxLength={180}
            />
          </label>

          <label className="onboarding-field" htmlFor="resident-perspective">
            <span>Add a little context</span>
            <small>Optional · this shapes your local in-app profile only</small>
            <textarea
              id="resident-perspective"
              value={perspective}
              onChange={(event) => setPerspective(event.target.value)}
              placeholder="I work nearby and want to understand the tradeoffs…"
              rows={3}
              maxLength={240}
            />
          </label>

          <button className="onboarding-submit onboarding-submit--primary" type="submit">
            Enter {scen.townMeta(town).name}
          </button>
        </form>
      </section>
    </main>
  );
}
