import { execSync } from "child_process";
import { statSync } from "fs";
import { getConfig, getProjectRoot } from "../config/config.js";

export interface ScanResult {
  passed: boolean;
  issues: string[];
}

const MAX_CHANGED_FILES = 50;
const MAX_FILE_SIZE_KB  = 500;

/**
 * @param changedFiles 변경된 파일 목록
 * @param cwdOrAllowedPaths cwd 문자열 또는 allowedPaths 배열 (스케줄러 호환)
 */
export function scanBeforePR(changedFiles: string[], cwdOrAllowedPaths: string | string[]): ScanResult {
  const config = getConfig();
  const issues: string[] = [];

  // allowedPaths와 cwd 분리
  const allowedPaths: string[] = Array.isArray(cwdOrAllowedPaths)
    ? cwdOrAllowedPaths
    : config.omc.allowedPaths;
  const cwd: string = Array.isArray(cwdOrAllowedPaths)
    ? getProjectRoot()
    : cwdOrAllowedPaths;

  // 1. allowedPaths 범위 검증
  for (const file of changedFiles) {
    const inAllowed = allowedPaths.some(p => file.includes(p));
    if (!inAllowed) {
      issues.push(`허용되지 않은 경로에 파일이 변경됨: ${file}`);
    }
  }

  // 2. 변경 파일 수 임계값
  if (changedFiles.length > MAX_CHANGED_FILES) {
    issues.push(`변경 파일 수(${changedFiles.length})가 임계값(${MAX_CHANGED_FILES})을 초과했습니다.`);
  }

  // 3. 파일 크기 임계값
  for (const file of changedFiles) {
    try {
      const stat = statSync(file);
      const sizeKb = stat.size / 1024;
      if (sizeKb > MAX_FILE_SIZE_KB) {
        issues.push(`파일 크기(${sizeKb.toFixed(1)}KB)가 임계값(${MAX_FILE_SIZE_KB}KB)을 초과: ${file}`);
      }
    } catch {
      // 파일이 삭제된 경우 무시
    }
  }

  // 4. ESLint 실행
  if (config.security.preScanEnabled) {
    const tsFiles = changedFiles.filter(f => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js"));
    if (tsFiles.length > 0) {
      try {
        execSync(`npx eslint ${tsFiles.map(f => `"${f}"`).join(" ")} --max-warnings 0`, {
          cwd,
          stdio: "pipe",
          timeout: 60_000,
        });
      } catch (err: any) {
        const output = err.stdout?.toString() || err.message || "";
        issues.push(`ESLint 검사 실패:\n${output.slice(0, 2000)}`);
      }
    }
  }

  // 5. git-secrets 실행 (설치 여부 확인)
  if (config.security.secretScanEnabled) {
    const gitSecretsAvailable = isCommandAvailable("git-secrets");
    if (gitSecretsAvailable) {
      try {
        execSync("git secrets --scan", { cwd, stdio: "pipe", timeout: 30_000 });
      } catch (err: any) {
        const output = err.stdout?.toString() || err.stderr?.toString() || err.message || "";
        issues.push(`git-secrets 스캔 실패 (시크릿 검출):\n${output.slice(0, 2000)}`);
      }
    } else {
      console.warn("[PrePRScanner] git-secrets가 설치되지 않아 시크릿 스캔을 건너뜁니다.");
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
