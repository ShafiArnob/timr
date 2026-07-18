"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { getCountry } from "@/lib/countries";
import { isTaskColor } from "@/lib/task-colors";

export type SettingsState =
  | { status: "success"; message: string }
  | { status: "error"; message: string }
  | undefined;

export async function updateTimezone(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { userId } = await verifySession();

  const countryCode = String(formData.get("country") ?? "");
  const timezone = String(formData.get("timezone") ?? "");

  const country = getCountry(countryCode);
  if (!country) {
    return { status: "error", message: "Please choose a valid country." };
  }
  if (!country.timezones.includes(timezone)) {
    return {
      status: "error",
      message: "Please choose a time zone for the selected country.",
    };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { country: country.code, timezone },
    });
  } catch (error) {
    console.error("Failed to update timezone:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  revalidatePath("/settings");
  return { status: "success", message: "Time zone saved." };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createTask(
  _state: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { userId } = await verifySession();

  const label = String(formData.get("label") ?? "").trim();
  const color = String(formData.get("color") ?? "");

  if (!label) {
    return { status: "error", message: "Please enter a task label." };
  }
  // The value is always derived from the label: lowercased, spaces → dashes.
  const value = slugify(label);
  if (!value) {
    return {
      status: "error",
      message: "The label must contain at least one letter or number.",
    };
  }
  if (!isTaskColor(color)) {
    return { status: "error", message: "Please choose one of the colors." };
  }

  try {
    await prisma.task.create({
      data: { label, value, color, userId },
    });
  } catch (error) {
    console.error("Failed to create task:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  revalidatePath("/settings");
  return { status: "success", message: "Task added." };
}

export async function deleteTask(formData: FormData): Promise<void> {
  const { userId } = await verifySession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  try {
    // Scope the delete by userId so a task can only be removed by its owner.
    await prisma.task.deleteMany({ where: { id, userId } });
  } catch (error) {
    console.error("Failed to delete task:", error);
  }

  revalidatePath("/settings");
}
