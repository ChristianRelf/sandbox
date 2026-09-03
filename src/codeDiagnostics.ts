import { parser as cssParser } from "@lezer/css";
import { parser as htmlParser } from "@lezer/html";
import { parser as pythonParser } from "@lezer/python";
import { parse } from "acorn";
import type { CodeLanguage } from "./components/CodeEditorDialog";

export interface CodeDiagnostic {
  code: "code_syntax" | "code_type_mismatch";
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

export function diagnoseCode(language: CodeLanguage, code: string): CodeDiagnostic[] {
  if (!code.trim()) return [];
  const diagnostics = language === "javascript"
    ? javascriptSyntax(code)
    : lezerSyntax(language, code);
  if (language === "javascript") diagnostics.push(...javascriptTypes(code));
  if (language === "python") diagnostics.push(...pythonTypes(code));
  return uniqueDiagnostics(diagnostics).slice(0, 100);
}

function javascriptSyntax(code: string): CodeDiagnostic[] {
  try {
    parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
    return [];
  } catch (value) {
    const error = value as SyntaxError & { loc?: { line: number; column: number } };
    return [{
      code: "code_syntax",
      severity: "error",
      message: error.message.replace(/ \(\d+:\d+\)$/, ""),
      line: error.loc?.line ?? 1,
      column: (error.loc?.column ?? 0) + 1,
    }];
  }
}

function lezerSyntax(language: Exclude<CodeLanguage, "javascript">, code: string): CodeDiagnostic[] {
  const parser = language === "python" ? pythonParser : language === "html" ? htmlParser : cssParser;
  const tree = parser.parse(code);
  const cursor = tree.cursor();
  const diagnostics: CodeDiagnostic[] = [];
  do {
    if (cursor.type.isError) {
      const position = offsetPosition(code, cursor.from);
      diagnostics.push({
        code: "code_syntax",
        severity: "error",
        message: syntaxMessage(language, code, cursor.from, cursor.to),
        ...position,
      });
    }
  } while (cursor.next());
  return diagnostics;
}

function syntaxMessage(language: string, code: string, from: number, to: number) {
  const token = code.slice(from, Math.max(from + 1, to)).trim();
  if (language === "python") return token ? `Unexpected Python token “${token.slice(0, 24)}”.` : "Incomplete Python statement.";
  if (language === "html") return token ? `Invalid or misplaced HTML near “${token.slice(0, 24)}”.` : "Incomplete HTML element.";
  return token ? `Invalid CSS near “${token.slice(0, 24)}”.` : "Incomplete CSS rule.";
}

function javascriptTypes(code: string): CodeDiagnostic[] {
  const known = new Map<string, string>();
  const diagnostics: CodeDiagnostic[] = [];
  code.split("\n").forEach((line, index) => {
    const declaration = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/);
    if (declaration) {
      const inferred = literalType(declaration[2]);
      if (inferred !== "unknown" && inferred !== "null") known.set(declaration[1], inferred);
      return;
    }
    const assignment = line.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/);
    if (!assignment) return;
    const previous = known.get(assignment[1]);
    const next = literalType(assignment[2]);
    if (previous && next !== "unknown" && next !== "null" && previous !== next) {
      diagnostics.push({
        code: "code_type_mismatch",
        severity: "warning",
        message: `“${assignment[1]}” was initialized as ${previous}, but this assignment is ${next}.`,
        line: index + 1,
        column: line.indexOf(assignment[1]) + 1,
      });
    }
  });
  return diagnostics;
}

function pythonTypes(code: string): CodeDiagnostic[] {
  const diagnostics: CodeDiagnostic[] = [];
  const aliases: Record<string, string[]> = {
    str: ["string"],
    int: ["integer"],
    float: ["integer", "number"],
    bool: ["boolean"],
    list: ["array"],
    dict: ["object"],
  };
  code.split("\n").forEach((line, index) => {
    const annotation = line.match(/^\s*([A-Za-z_]\w*)\s*:\s*(str|int|float|bool|list|dict)\s*=\s*(.+?)(?:\s+#.*)?$/);
    if (!annotation) return;
    const actual = literalType(annotation[3]);
    if (actual === "unknown" || actual === "null" || aliases[annotation[2]].includes(actual)) return;
    diagnostics.push({
      code: "code_type_mismatch",
      severity: "error",
      message: `“${annotation[1]}” is annotated as ${annotation[2]}, but the assigned value is ${actual}.`,
      line: index + 1,
      column: line.indexOf(annotation[1]) + 1,
    });
  });
  return diagnostics;
}

function literalType(expression: string) {
  const value = expression.trim();
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)$/.test(value)) return "string";
  if (/^[+-]?\d+$/.test(value)) return "integer";
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(value)) return "number";
  if (/^(?:true|false|True|False)$/.test(value)) return "boolean";
  if (/^\[.*\]$/.test(value)) return "array";
  if (/^\{.*\}$/.test(value)) return "object";
  if (/^(?:null|None|undefined)$/.test(value)) return "null";
  return "unknown";
}

function offsetPosition(code: string, offset: number) {
  const before = code.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function uniqueDiagnostics(diagnostics: CodeDiagnostic[]) {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.severity}:${item.line}:${item.column}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.line - right.line || left.column - right.column);
}
