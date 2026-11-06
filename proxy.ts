import { NextResponse, type NextRequest } from "next/server";

// Redirection rapide des visiteurs sans session. La vérification cryptographique de la session
// et des droits a lieu côté serveur (lib/auth/context.ts) et dans la base (RLS).
const PUBLIC = ["/login", "/api/webhooks", "/api/cron", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.get("fa_session")?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
