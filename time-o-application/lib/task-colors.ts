export type TaskColor = {
  name: string;
  hex: string;
};

// Pastel palette (Tailwind "300" shades): soft enough to read as pastel on
// light backgrounds, bright enough to stay visible on dark ones.
export const TASK_COLORS: TaskColor[] = [
  { name: "Red", hex: "#fca5a5" },
  { name: "Orange", hex: "#fdba74" },
  { name: "Amber", hex: "#fcd34d" },
  { name: "Lime", hex: "#bef264" },
  { name: "Green", hex: "#86efac" },
  { name: "Emerald", hex: "#6ee7b7" },
  { name: "Teal", hex: "#5eead4" },
  { name: "Cyan", hex: "#67e8f9" },
  { name: "Sky", hex: "#7dd3fc" },
  { name: "Blue", hex: "#93c5fd" },
  { name: "Indigo", hex: "#a5b4fc" },
  { name: "Violet", hex: "#c4b5fd" },
  { name: "Purple", hex: "#d8b4fe" },
  { name: "Fuchsia", hex: "#f0abfc" },
  { name: "Pink", hex: "#f9a8d4" },
  { name: "Rose", hex: "#fda4af" },
];

export function isTaskColor(hex: string): boolean {
  return TASK_COLORS.some((color) => color.hex === hex);
}
