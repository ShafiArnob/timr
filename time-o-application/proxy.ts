import { NextResponse, type NextRequest } from "next/server";
import { decrypt } from "@/lib/session";

// Routes that require an authenticated session.
const protectedPrefixes = ["/dashboard"];
// Auth routes that a signed-in user should be bounced away from.
const authRoutes = ["/login", "/signup"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isRoot = pathname === "/";
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthRoute = authRoutes.includes(pathname);

  // Nothing to guard on this route.
  if (!isRoot && !isProtected && !isAuthRoute) {
    return NextResponse.next();
  }

  // Optimistic check: only read the session from the cookie here (no DB call).
  const cookie = req.cookies.get("session")?.value;
  const session = await decrypt(cookie);

  if (isRoot) {
    return NextResponse.redirect(
      new URL(session?.userId ? "/dashboard" : "/login", req.nextUrl),
    );
  }

  if (isProtected && !session?.userId) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isAuthRoute && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
