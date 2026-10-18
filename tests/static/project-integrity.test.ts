import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRODUCTION_CATALOG } from "../../miniprogram/data/catalog.production";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const miniprogramRoot = resolve(workspaceRoot, "miniprogram");

function readPageFile(
  page: "entry" | "sample" | "result",
  extension: "ts" | "wxml" | "wxss",
): string {
  return readFileSync(
    resolve(miniprogramRoot, "pages", page, `index.${extension}`),
    "utf8",
  );
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? collectSourceFiles(path)
      : /\.(?:ts|js|wxml)$/.test(name)
        ? [path]
        : [];
  });
}

describe("project integrity", () => {
  it("resolves relative imports as files in the native WeChat module loader", () => {
    // TypeScript/Vitest resolve directory index files; the WeChat runtime does not.
    // Check type imports too so converting one to a value import stays safe.
    const findings = collectSourceFiles(miniprogramRoot)
      .filter((path) => /\.(?:ts|js)$/.test(path))
      .flatMap((path) => Array.from(
        readFileSync(path, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g),
        (match) => {
          const target = resolve(dirname(path), match[1]);
          const resolves = [target, `${target}.ts`, `${target}.js`, `${target}.json`]
            .some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
          return resolves ? [] : [`${relative(miniprogramRoot, path)}: ${match[1]}`];
        },
      ).flat());
    expect(findings).toEqual([]);
  });

  it("keeps the production catalog empty until evidence is supplied", () => {
    expect(PRODUCTION_CATALOG).toEqual([]);
  });

  it("declares the sampling flow plus photo and live try-on pages", () => {
    const appConfig = JSON.parse(
      readFileSync(resolve(miniprogramRoot, "app.json"), "utf8"),
    ) as { pages: string[] };

    expect(appConfig.pages).toEqual([
      "pages/entry/index",
      "pages/sample/index",
      "pages/result/index",
      "pages/studio/index",
      "pages/live/index",
    ]);
  });

  it("does not upload, request, persist or save user analysis data", () => {
    const forbidden = [
      /\bwx\.uploadFile\b/,
      /\bwx\.request\b/,
      /\bwx\.setStorage(?:Sync)?\b/,
      /\bwx\.saveFile\b/,
      /\bwx\.cloud\b/,
      /\.(?:writeFile|writeFileSync|appendFile|appendFileSync|saveFile|copyFile|rename|mkdir)\s*\(/,
    ];

    const findings = collectSourceFiles(miniprogramRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path}: ${pattern.source}`);
    });

    expect(findings).toEqual([]);
  });

  it("uses the file-system manager only to remove an app-generated preview", () => {
    const methods = collectSourceFiles(miniprogramRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(
        source.matchAll(/\bwx\.getFileSystemManager\(\)\.(\w+)\s*\(/g),
        (match) => match[1],
      );
    });

    expect(methods).toEqual(["unlink"]);
  });

  it("keeps the result commerce action fixed without covering page content", () => {
    const template = readPageFile("result", "wxml");
    const styles = readPageFile("result", "wxss");

    expect(template).toContain('class="commerce-dock-spacer" aria-hidden="true"');
    expect(template).toMatch(
      /commerce-dock-spacer[\s\S]*<\/view>\s*<\/block>\s*<\/view>\s*<view[^>]+class="commerce-dock"/,
    );
    expect(styles).toMatch(
      /\.commerce-dock-spacer\s*{[^}]*visibility:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /\.commerce-dock\s*{[^}]*position:\s*fixed;[^}]*bottom:\s*0;/s,
    );
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("retains visible color values and single-flight interaction guards", () => {
    const sampleTemplate = readPageFile("sample", "wxml");
    const resultTemplate = readPageFile("result", "wxml");
    const entryPage = readPageFile("entry", "ts");
    const samplePage = readPageFile("sample", "ts");
    const sampleStyles = readPageFile("sample", "wxss");
    const resultPage = readPageFile("result", "ts");

    expect(sampleTemplate).toContain("{{coverColorText}}");
    expect(sampleTemplate).toContain("{{referenceColorText}}");
    expect(resultTemplate).toContain("{{coverColorText}}");
    expect(resultTemplate).toContain("{{referenceColorText}}");
    expect(sampleTemplate).toContain('disabled="{{isAnalyzing || navigationBusy}}"');
    expect(resultTemplate).toContain('disabled="{{commerceOpening || navigationBusy}}"');
    expect(entryPage).toContain("runtime.navigationBusy = true");
    expect(entryPage).toContain("runtime.navigationBusy ||");
    expect(samplePage).toContain("navigationBusy");
    expect(samplePage).not.toMatch(
      /^let (?:stageLayout|dragState|placementRequest|unsubscribe|initialized|returningToEntry)\b/m,
    );
    expect(sampleStyles).toContain("width: max(276rpx, 144px)");
    expect(sampleStyles).toContain("repeat(3, max(88rpx, 44px))");
    expect(resultPage).toContain("isResultOperationActive");
  });
});

