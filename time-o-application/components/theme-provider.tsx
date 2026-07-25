"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Client boundary around next-themes so the root layout can stay a Server
 * Component. The provider writes `class="dark"` onto <html>, which is what
 * the `dark` custom variant in globals.css keys off.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
