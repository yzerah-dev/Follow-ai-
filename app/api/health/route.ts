import { NextResponse } from "next/server";
import { pool } from "@/lib/database/pool";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool().query("select 1");
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
