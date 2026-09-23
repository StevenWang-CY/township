import { describe, expect, it } from "vitest";
import { deriveActivity, dwellRoles, placeKind, shouldBeIndoors } from "./DayPart";
import type { LandmarkData } from "../types/messages";

const lm = (name: string, type: string): LandmarkData => ({ name, type, x: 0, y: 0, width: 100, height: 80, color: "#000" });
const FACTORY = lm("Factory", "building");
const LA_FINCA = lm("La Finca Restaurant", "building");
const CHURCH = lm("St. Mary's Church", "church");
const PARK = lm("Town Park", "park");
const HOUSING = lm("Public Housing", "housing");
const STATION = lm("Dover Station", "transport");
const LIBRARY = lm("Public Library", "building");
const entry = (time: string, location: string, activity: string) => ({ time, location, activity });

describe("deriveActivity (Dover routines, verbatim)", () => {
  it("reads jobs written in the personas' own words", () => {
    expect(deriveActivity(entry("07:30", "Factory", "Drywall on a warehouse renovation, no questions asked"), FACTORY, "morning", 7.5)).toBe("working");
    expect(deriveActivity(entry("07:00", "Factory", "Reports to Morris Hills Care Center — bed baths, vitals, charting"), FACTORY, "morning", 7)).toBe("working");
    expect(deriveActivity(entry("14:00", "Public Library", "Reads Listin Diario, helps a neighbor write a letter to the landlord"), LIBRARY, "midday", 14)).toBe("working");
  });

  it("puts staff to work and diners to lunch at a restaurant", () => {
    expect(deriveActivity(entry("08:00", "La Finca Restaurant", "Opens La Finca, preps stocks and arepa dough"), LA_FINCA, "morning", 8)).toBe("working");
    expect(deriveActivity(entry("11:00", "La Finca Restaurant", "Lunch rush — bandeja paisa orders nonstop"), LA_FINCA, "midday", 11)).toBe("working");
    expect(deriveActivity(entry("12:30", "La Finca Restaurant", "Quick empanada lunch, jots notes for her op-ed"), LA_FINCA, "midday", 12.5)).toBe("eating");
    expect(deriveActivity(entry("12:00", "Factory", "Tailgate lunch with the Puebla crew, jokes in Spanish"), FACTORY, "midday", 12)).toBe("eating");
    const BODEGA = lm("Bodega Row", "building");
    expect(deriveActivity(entry("12:00", "Bodega Row", "Cafecito break, vents to the woman at the counter in Spanglish"), BODEGA, "midday", 12)).toBe("eating");
    expect(deriveActivity(entry("13:00", "Bodega Row", "Coffee with Carlos on the curb — comfortable silence"), BODEGA, "midday", 13)).toBe("eating");
  });

  it("keeps curb coffee and tailgate lunches outside", () => {
    const BODEGA = lm("Bodega Row", "building");
    expect(shouldBeIndoors(BODEGA, "eating", 13, "Coffee with Carlos on the curb — comfortable silence")).toBe(false);
    expect(shouldBeIndoors(FACTORY, "eating", 12, "Tailgate lunch with the Puebla crew, jokes in Spanish")).toBe(false);
    expect(shouldBeIndoors(BODEGA, "eating", 12, "Cafecito break, vents to the woman at the counter in Spanglish")).toBe(true);
    expect(shouldBeIndoors(BODEGA, "eating", 22, "Coffee on the curb")).toBe(true);
  });

  it("knows church, parks, platforms and the night", () => {
    expect(deriveActivity(entry("08:30", "St. Mary's Church", "Daily mass — front row, left side"), CHURCH, "morning", 8.5)).toBe("praying");
    expect(deriveActivity(entry("09:00", "Town Park", "Slow walk through what used to be Crescent Field"), PARK, "morning", 9)).toBe("idle");
    expect(deriveActivity(entry("15:30", "Dover Station", "Picks up the kids from after-school"), STATION, "midday", 15.5)).toBe("idle");
    expect(deriveActivity(entry("22:30", "Public Housing", "Falls asleep on the couch with the lights on"), HOUSING, "night", 22.5)).toBe("sleeping");
    expect(deriveActivity(entry("19:00", "Public Housing", "Dinner alone, ESPN"), HOUSING, "evening", 19)).toBe("idle");
    expect(deriveActivity(undefined, FACTORY, "night", 23)).toBe("idle");
  });
});

describe("places", () => {
  it("classifies landmarks by type first, then name", () => {
    expect(placeKind(STATION)).toBe("transport");
    expect(placeKind(PARK)).toBe("open");
    expect(placeKind(HOUSING)).toBe("home");
    expect(placeKind(LA_FINCA)).toBe("food");
    expect(placeKind(CHURCH)).toBe("worship");
    expect(placeKind(lm("Blackwell Street", "road"))).toBe("road");
    expect(placeKind(FACTORY)).toBe("building");
  });

  it("sends work, meals, prayer and rest indoors — never parks or platforms", () => {
    expect(shouldBeIndoors(FACTORY, "working", 9)).toBe(true);
    expect(shouldBeIndoors(LA_FINCA, "eating", 12.5)).toBe(true);
    expect(shouldBeIndoors(CHURCH, "praying", 8.5)).toBe(true);
    expect(shouldBeIndoors(HOUSING, "idle", 21.5)).toBe(true);
    expect(shouldBeIndoors(HOUSING, "idle", 12)).toBe(false);
    expect(shouldBeIndoors(FACTORY, "idle", 12)).toBe(false);
    expect(shouldBeIndoors(PARK, "eating", 12.5)).toBe(false);
    expect(shouldBeIndoors(STATION, "idle", 23)).toBe(false);
  });

  it("ranks standing spots by place", () => {
    expect(dwellRoles(PARK, "idle")[0]).toBe("lawn");
    expect(dwellRoles(STATION, "idle")[0]).toBe("platform");
    expect(dwellRoles(LA_FINCA, "eating")[0]).toBe("table");
    expect(dwellRoles(FACTORY, "idle")[0]).toBe("porch");
  });
});
