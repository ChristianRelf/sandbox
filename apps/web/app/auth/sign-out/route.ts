import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "../../../lib/auth";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/sign-in", request.url), 303);
  response.cookies.set(sessionCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
