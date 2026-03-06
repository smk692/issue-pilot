import { getConfig } from "../config/config.js";

const MAX_INPUT_LENGTH = 10_000;

// 위험한 프롬프트 인젝션 패턴 (대소문자 무시)
const BUILTIN_BLOCKED_PATTERNS = [
  /system\s+prompt/gi,
  /ignore\s+previous/gi,
  /override\s+instructions/gi,
  /forget\s+everything/gi,
  /you\s+are\s+now/gi,
  /new\s+instructions/gi,
  /disregard\s+all/gi,
];

// HTML/스크립트 태그
const HTML_SCRIPT_PATTERN = /<\s*(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const HTML_TAG_PATTERN     = /<[^>]+>/g;

export function sanitizeIssueBody(body: string, extraBlockedPatterns?: string[]): string {
  if (!body) return "";

  const config = getConfig();
  let sanitized = body;

  // 1. 최대 길이 제한
  if (sanitized.length > MAX_INPUT_LENGTH) {
    console.warn(`[InputSanitizer] 입력이 최대 길이(${MAX_INPUT_LENGTH})를 초과하여 잘랐습니다.`);
    sanitized = sanitized.slice(0, MAX_INPUT_LENGTH);
  }

  // 2. HTML 스크립트/위험 태그 제거
  sanitized = sanitized.replace(HTML_SCRIPT_PATTERN, "[제거됨: 위험 HTML 태그]");
  sanitized = sanitized.replace(HTML_TAG_PATTERN, "");

  // 3. 빌트인 차단 패턴 필터링
  for (const pattern of BUILTIN_BLOCKED_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn(`[InputSanitizer] 위험 패턴 감지: ${pattern}`);
      sanitized = sanitized.replace(pattern, "[제거됨: 금지 패턴]");
    }
  }

  // 4. config + 추가 차단 패턴 필터링
  const allBlockedPatterns = [
    ...(config.security.sanitizeInput ? (config.security.blockedPatterns ?? []) : []),
    ...(extraBlockedPatterns ?? []),
  ];
  for (const raw of allBlockedPatterns) {
    const pattern = new RegExp(escapeRegex(raw), "gi");
    if (pattern.test(sanitized)) {
      console.warn(`[InputSanitizer] 설정 차단 패턴 감지: "${raw}"`);
      sanitized = sanitized.replace(pattern, "[제거됨: 금지 패턴]");
    }
  }

  return sanitized.trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
