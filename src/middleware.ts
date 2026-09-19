export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/schedule/:path*",
    "/checkin/:path*",
    "/leave/:path*",
    "/attest/:path*",
    "/teachers/:path*",
    "/lesson-plans/:path*",
    "/admin/:path*",
    "/change-password/:path*",
  ],
};
