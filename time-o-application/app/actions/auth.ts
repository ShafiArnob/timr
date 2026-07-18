"use server";

import * as z from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/session";
import {
  LoginFormSchema,
  SignupFormSchema,
  type FormState,
} from "@/lib/definitions";

export async function signup(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const validatedFields = SignupFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { errors: z.flattenError(validatedFields.error).fieldErrors };
  }

  const { name, email, password } = validatedFields.data;

  let userId: string;
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { errors: { email: ["An account with this email already exists."] } };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword },
      select: { id: true },
    });
    userId = user.id;
  } catch (error) {
    console.error("Signup failed:", error);
    return { message: "Something went wrong. Please try again." };
  }

  await createSession(userId);
  redirect("/dashboard");
}

export async function login(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const validatedFields = LoginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { errors: z.flattenError(validatedFields.error).fieldErrors };
  }

  const { email, password } = validatedFields.data;

  let userId: string;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    // Compare against a valid-looking hash even when the user is missing to
    // reduce timing differences between "no such user" and "wrong password".
    const passwordMatches = user
      ? await bcrypt.compare(password, user.password)
      : false;

    if (!user || !passwordMatches) {
      return { message: "Invalid email or password." };
    }
    userId = user.id;
  } catch (error) {
    console.error("Login failed:", error);
    return { message: "Something went wrong. Please try again." };
  }

  await createSession(userId);
  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
