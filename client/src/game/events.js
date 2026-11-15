// Something happens on about a third of flights, and the player picks one of two options.
// Each option trades fuel, seconds on the clock or credits. On the board 1 fuel is worth 3 s
// (1 point per 2 fuel, 1 point per 6 s), and fuel also pays for lanes.
export const EVENT_CHANCE = 1 / 3;

export const FLIGHT_EVENTS = Object.freeze([
  {
    id: "debris",
    title: "Debris field",
    text: "Rocks are drifting across your route.",
    options: [
      { label: "Swerve around", fuel: -1 },
      { label: "Push through slowly", time: -20 },
    ],
  },
  {
    id: "storm",
    title: "Ion storm",
    text: "A storm is crossing your path.",
    options: [
      { label: "Raise shields", credits: -5 },
      { label: "Wait it out", time: -30 },
    ],
  },
  {
    id: "tanker",
    title: "Drifting tanker",
    text: "A wrecked tanker still has fuel on board.",
    options: [
      { label: "Siphon it", fuel: 2, time: -30 },
      { label: "Fly on" },
    ],
  },
  {
    id: "distress",
    title: "Distress call",
    text: "A stranded cargo pod will pay you to tow it.",
    options: [
      { label: "Tow it", credits: 10, time: -30 },
      { label: "Fly on" },
    ],
  },
  {
    id: "slingshot",
    title: "Gravity slingshot",
    text: "A star's pull could speed you up.",
    options: [
      { label: "Slingshot", fuel: -1, time: 30 },
      { label: "Fly on" },
    ],
  },
]);

/** Fuel and credits can't go below zero; time can always be spent. */
export function canTake(option, { fuel, credits }) {
  return fuel + (option.fuel ?? 0) >= -1e-9 && credits + (option.credits ?? 0) >= 0;
}
