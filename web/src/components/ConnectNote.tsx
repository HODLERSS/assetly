import type { CSSProperties } from "react";
import { IMPORT_FULL_MSG, isImportFull } from "../lib/api";

/**
 * What a brokerage Connect/Import tap came back with. "At capacity during early access" is an expected product
 * state, so it reads as a calm neutral note (role=status), not the red error box (r7 design n-1). Anything else
 * is a real failure and keeps the error style.
 */
export type ConnectMsg = { full: boolean; text: string };

export function connectMsg(e: unknown, fallback = "Could not start the brokerage link."): ConnectMsg {
  if (isImportFull(e)) return { full: true, text: IMPORT_FULL_MSG };
  return { full: false, text: e instanceof Error && e.message ? e.message : fallback };
}

export function ConnectNote({ msg, testId, style }: { msg: ConnectMsg | null; testId?: string; style?: CSSProperties }) {
  if (!msg) return null;
  return msg.full
    ? <div className="info-note" role="status" data-testid={testId} data-full="true" style={style}>{msg.text}</div>
    : <div className="error-note" role="alert" data-testid={testId} style={style}>{msg.text}</div>;
}
