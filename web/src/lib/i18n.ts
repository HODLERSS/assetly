// The few chrome strings that follow a Korean reader's device language. The app is not localized; under ko-KR the
// holding names and the answers were Korean while the shell stayed English, which read as "not yet localized"
// (e2e p03 F4). These two strings make the split deliberate: the disclaimer every card ends with, and the Ask
// prompt, in the reader's language. Everything else stays English on purpose.
import { prefersKoreanNames } from "./format";

export const isKorean = (): boolean => prefersKoreanNames();

/** "Not financial advice", under every card and answer. */
export const notAdvice = (): string => (isKorean() ? "투자 조언이 아닙니다" : "Not financial advice");

/** The Ask composer's placeholder: `short` for a narrow screen or large text. */
export const askPlaceholder = (short: "long" | "short" | "shortest"): string => {
  if (isKorean()) return short === "shortest" ? "질문…" : short === "short" ? "질문하기…" : "내 포트폴리오에 대해 물어보세요…";
  return short === "shortest" ? "Ask…" : short === "short" ? "Ask a question…" : "Ask about your portfolio…";
};
