import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

/**
 * Supabase client for Next.js Route Handlers.
 * Uses the user's session via cookies.
 */
export function getRouteClient() {
  return createRouteHandlerClient({ cookies });
}
