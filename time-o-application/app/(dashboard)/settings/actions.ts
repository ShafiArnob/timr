"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { getCountry } from "@/lib/countries";

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
