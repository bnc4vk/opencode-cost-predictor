import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const scoreDataPath = path.join(root, ".opencode", "plugins", "model-score-data.mjs");

const SOURCES = {
  opencodeData: "https://opencode.ai/data/",
  terminalBench21: "https://www.tbench.ai/leaderboard/terminal-bench/2.1",
  terminalBench20: "https://www.tbench.ai/leaderboard/terminal-bench/2.0",
  artificialAnalysisTerminalBench21: "https://artificialanalysis.ai/evaluations/terminalbench-v2-1",
};

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}

function bareModelID(modelID) {
  return modelID.includes("/") ? modelID.split("/").at(-1) : modelID;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseTerminalBenchRows(html, { benchmark, source }) {
  const start = html.indexOf('rows\\":[');
  const end = html.indexOf('],\\"className', start);
  if (start === -1 || end === -1) throw new Error(`Could not find ${benchmark} rows payload.`);

  const escaped = html.slice(start + 'rows\\":'.length, end + 1);
  const rows = JSON.parse(escaped.replace(/\\"/g, '"'));

  return rows.flatMap((row) => {
    const models = row.modelNames?.length ? row.modelNames : row.model;
    return (models ?? []).map((modelName, index) => ({
      agent: row.agent,
      agentName: row.agentName,
      agentVersion: row.agentVersion,
      model: row.model?.[index] ?? row.model?.[0] ?? modelName,
      modelName,
      modelProvider: row.modelProviders?.[index] ?? row.modelProviders?.[0],
      modelStack: row.model?.length > 1 ? row.model.join(", ") : undefined,
      date: row.date,
      score: row.accuracy * 100,
      benchmark,
      source,
    }));
  });
}

function terminalBenchAliases(row) {
  const withoutPreview = row.modelName?.replace(/-preview$/u, "");
  const aliases = [
    row.modelName,
    withoutPreview,
    row.model,
    row.modelName && `opencode/${row.modelName}`,
    withoutPreview && `opencode/${withoutPreview}`,
    row.modelProvider && row.modelName && `${row.modelProvider}/${row.modelName}`,
    row.modelProvider && withoutPreview && `${row.modelProvider}/${withoutPreview}`,
  ];

  return unique(aliases.map((alias) => String(alias ?? "")));
}

function averageTerminalBenchRows(rows) {
  const byModel = new Map();

  for (const row of rows) {
    const key = normalize(row.modelName ?? row.model);
    if (!key) continue;

    const existing = byModel.get(key) ?? {
      aliases: [],
      rows: [],
    };
    existing.aliases.push(...terminalBenchAliases(row));
    existing.rows.push(row);
    byModel.set(key, existing);
  }

  return Array.from(byModel.values())
    .map((entry) => {
      const score = entry.rows.reduce((sum, row) => sum + row.score, 0) / entry.rows.length;
      return {
        aliases: unique(entry.aliases),
        score,
        benchmark: entry.rows[0]?.benchmark ?? "Terminal-Bench",
        source: entry.rows[0]?.source ?? "",
        harnesses: entry.rows
          .sort((a, b) => b.score - a.score)
          .map((row) => ({
            agent: row.agent,
            agentName: row.agentName,
            agentVersion: row.agentVersion,
            model: row.model,
            modelStack: row.modelStack,
            date: row.date,
            score: row.score,
            benchmark: row.benchmark,
            source: row.source,
          })),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function hasBenchmarkAlias(rows, alias) {
  const key = normalize(bareModelID(alias));
  return rows.some((row) => row.aliases.some((candidate) => normalize(bareModelID(candidate)) === key));
}

function artificialAnalysisBenchmarkRows(aaRows, existingRows) {
  const rows = [];
  const seen = new Set();

  for (const row of aaRows) {
    const covered = row.aliases.some((alias) => hasBenchmarkAlias(existingRows, alias));
    if (covered) continue;

    const key = row.aliases.map((alias) => normalize(bareModelID(alias))).find(Boolean);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    rows.push({
      aliases: row.aliases,
      score: row.benchmarkScore,
      benchmark: row.benchmark,
      source: row.source,
      harnesses: [
        {
          agent: "Terminus 2",
          agentName: "terminus-2",
          agentVersion: "Artificial Analysis",
          model: row.model,
          modelStack: undefined,
          date: undefined,
          score: row.benchmarkScore,
          benchmark: row.benchmark,
          source: row.source,
        },
      ],
    });
  }

  return rows.sort((a, b) => b.score - a.score);
}

function parseArtificialAnalysisTerminalBench21(html) {
  const decoded = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const objectStarts = [];
  let start = -1;

  while ((start = decoded.indexOf('{"additional_text"', start + 1)) >= 0) {
    objectStarts.push(start);
  }

  const rows = [];
  for (let index = 0; index < objectStarts.length; index++) {
    const chunk = decoded.slice(objectStarts[index], objectStarts[index + 1] ?? decoded.length);
    const score = Number(chunk.match(/"terminalbench_v2_1":([0-9.]+)/)?.[1]);
    const tokenCounts = chunk.match(
      /"tokenCounts":\{"inputTokens":([0-9]+),"answerTokens":([0-9]+),"reasoningTokens":([0-9]+),"outputTokens":([0-9]+)\}/,
    );
    const cost = Number(chunk.match(/"evalCost":\{"total":([0-9.]+)/)?.[1]);
    const name = chunk.match(/"name":"([^"]+)"/)?.[1];
    const shortName = chunk.match(/"short_name":"([^"]+)"/)?.[1];
    const slug = chunk.match(/"slug":"([^"]+)"/)?.[1];
    const creator = chunk.match(/"model_creators":\{[\s\S]*?"slug":"([^"]+)"/)?.[1];

    if (!Number.isFinite(score) || !tokenCounts || !name || !slug) continue;

    const inputTokens = Number(tokenCounts[1]);
    const answerTokens = Number(tokenCounts[2]);
    const reasoningTokens = Number(tokenCounts[3]);
    const outputTokens = Number(tokenCounts[4]);
    if (!Number.isFinite(outputTokens) || outputTokens <= 0) continue;

    rows.push({
      aliases: modelNameAliases({ name, shortName, slug, creator }),
      model: name,
      shortName,
      benchmarkScore: score * 100,
      inputTokens,
      answerTokens,
      reasoningTokens,
      outputTokens,
      evalCost: Number.isFinite(cost) ? cost : undefined,
      rawTokenEfficiency: score / outputTokens,
      source: SOURCES.artificialAnalysisTerminalBench21,
      benchmark: "Artificial Analysis Terminal-Bench v2.1",
      harness: "Terminus 2 in E2B",
    });
  }

  if (rows.length < 20) {
    throw new Error(`Artificial Analysis Terminal-Bench v2.1 parser found only ${rows.length} rows.`);
  }

  const maxEfficiency = Math.max(...rows.map((row) => row.rawTokenEfficiency));
  return rows.map((row) => ({
    ...row,
    tokenEfficiency: row.rawTokenEfficiency / maxEfficiency,
  }));
}

function stripParenthetical(value) {
  return String(value ?? "")
    .replace(/\s*\([^)]*\)/gu, "")
    .trim();
}

function modelNameAliases({ name, shortName, slug, creator }) {
  const names = unique([name, shortName, stripParenthetical(name), stripParenthetical(shortName), slug]);
  const withoutPreview = names.map((item) => item.replace(/-preview$/u, "").replace(/\s+Preview$/u, ""));
  const allNames = unique([...names, ...withoutPreview]);

  return unique(
    allNames.flatMap((item) => [
      item,
      normalize(item),
      `opencode/${normalize(item)}`,
      creator && `${creator}/${normalize(item)}`,
    ]),
  );
}

function parseOpenCodeCatalogCosts(html) {
  const rows = [];
  const idRe = /id:"([^"]+)"/g;
  let match;

  while ((match = idRe.exec(html))) {
    const id = match[1];
    const chunk = html.slice(match.index, match.index + 1500);
    const name = chunk.match(/name:"([^"]+)"/)?.[1];
    const cost = chunk.match(/cost:\$R\[\d+\]=\{input:([0-9.]+),output:([0-9.]+)(?:,cacheRead:([0-9.]+|void 0))?/);
    if (!name || !cost) continue;

    const bare = bareModelID(id);
    const withoutPreview = bare.replace(/-preview$/u, "");
    rows.push({
      aliases: unique([id, bare, withoutPreview, `opencode/${bare}`, `opencode/${withoutPreview}`, name]),
      name,
      input: Number(cost[1]),
      output: Number(cost[2]),
      cached: cost[3] && cost[3] !== "void 0" ? Number(cost[3]) : undefined,
      source: SOURCES.opencodeData,
    });
  }

  return rows;
}

function parseStatRows(html, sectionName) {
  const start = html.indexOf(`${sectionName}:$R[`);
  if (start === -1) return [];

  const sectionEnd = html.indexOf("],Enterprise:", start);
  if (sectionEnd === -1) return [];

  const section = html.slice(start, sectionEnd);
  const rows = [];
  const rowRe = /\{model:"([^"]+)"([^}]*)\}/g;
  let match;

  while ((match = rowRe.exec(section))) {
    const values = {};
    const valueRe = /([a-z]+):([0-9.]+)/g;
    let valueMatch;
    while ((valueMatch = valueRe.exec(match[2]))) {
      values[valueMatch[1]] = Number(valueMatch[2]);
    }
    rows.push({ model: match[1], ...values });
  }

  return rows;
}

function mergeTokenEfficiency(costRows, aaRows, sessionRows) {
  const aaEfficiencyByModel = new Map();
  for (const row of aaRows) {
    for (const alias of row.aliases) {
      const key = normalize(bareModelID(alias));
      const existing = aaEfficiencyByModel.get(key);
      if (!existing || row.tokenEfficiency > existing.tokenEfficiency) {
        aaEfficiencyByModel.set(key, row);
      }
    }
  }

  const rawEfficiencyByModel = new Map();

  for (const row of sessionRows) {
    if (typeof row.tokens !== "number" || typeof row.cost !== "number" || row.cost <= 0) continue;
    rawEfficiencyByModel.set(normalize(row.model), {
      costPerSession: row.cost,
      tokensPerSession: row.tokens,
      tokensPerDollar: row.tokens / row.cost,
    });
  }

  const maxTokensPerDollar = Math.max(0, ...Array.from(rawEfficiencyByModel.values()).map((row) => row.tokensPerDollar));

  return costRows
    .map((row) => {
      const aaEfficiency = aaEfficiencyByModel.get(normalize(bareModelID(row.aliases[0]))) ??
        row.aliases.map((alias) => aaEfficiencyByModel.get(normalize(bareModelID(alias)))).find(Boolean);
      const sessionEfficiency = rawEfficiencyByModel.get(normalize(bareModelID(row.aliases[0]))) ??
        row.aliases.map((alias) => rawEfficiencyByModel.get(normalize(bareModelID(alias)))).find(Boolean);
      const efficiency = aaEfficiency ?? sessionEfficiency;

      return {
        ...row,
        tokenEfficiency: aaEfficiency?.tokenEfficiency ??
          (sessionEfficiency && maxTokensPerDollar > 0 ? sessionEfficiency.tokensPerDollar / maxTokensPerDollar : undefined),
        tokenEfficiencySource: aaEfficiency ? aaEfficiency.source : efficiency ? SOURCES.opencodeData : undefined,
        tokenEfficiencyBenchmark: aaEfficiency?.benchmark ?? (efficiency ? "OpenCode session cost" : undefined),
        tokenEfficiencyHarness: aaEfficiency?.harness,
        tokenEfficiencyModel: aaEfficiency?.model,
        tokenEfficiencyFormula: aaEfficiency
          ? "Terminal-Bench v2.1 pass@1 divided by output tokens, normalized to the best fetched model"
          : efficiency
            ? "Tokens per session divided by cost per session, normalized to the best observed OpenCode model"
            : undefined,
        benchmarkScore: aaEfficiency?.benchmarkScore,
        inputTokens: aaEfficiency?.inputTokens,
        answerTokens: aaEfficiency?.answerTokens,
        reasoningTokens: aaEfficiency?.reasoningTokens,
        outputTokens: aaEfficiency?.outputTokens,
        evalCost: aaEfficiency?.evalCost,
        costPerSession: sessionEfficiency?.costPerSession,
        tokensPerSession: sessionEfficiency?.tokensPerSession,
        tokensPerDollar: sessionEfficiency?.tokensPerDollar,
      };
    })
    .sort((a, b) => a.aliases[0].localeCompare(b.aliases[0]));
}

function formatNumber(value) {
  if (value === undefined) return "undefined";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function formatBenchmarkRows(rows) {
  return rows
    .map((row) => {
      const aliases = row.aliases.map((alias) => JSON.stringify(alias)).join(", ");
      const harnesses = row.harnesses
        .map(
          (harness) => `      {
        agent: ${JSON.stringify(harness.agent)},
        agentName: ${JSON.stringify(harness.agentName)},
        agentVersion: ${JSON.stringify(harness.agentVersion)},
        model: ${JSON.stringify(harness.model)},
        modelStack: ${JSON.stringify(harness.modelStack)},
        date: ${JSON.stringify(harness.date)},
        score: ${formatNumber(harness.score)},
        benchmark: ${JSON.stringify(harness.benchmark)},
        source: ${JSON.stringify(harness.source)},
      },`,
        )
        .join("\n");

      return `  {
    aliases: [${aliases}],
    score: ${formatNumber(row.score)},
    benchmark: ${JSON.stringify(row.benchmark)},
    source: ${JSON.stringify(row.source)},
    harnesses: [
${harnesses}
    ],
  },`;
    })
    .join("\n");
}

function formatCostRows(rows) {
  return rows
    .map((row) => {
      const aliases = row.aliases.map((alias) => JSON.stringify(alias)).join(", ");
      const optional = [
        row.cached === undefined ? undefined : `    cached: ${formatNumber(row.cached)},`,
        row.tokenEfficiency === undefined ? undefined : `    tokenEfficiency: ${formatNumber(row.tokenEfficiency)},`,
        row.tokenEfficiencySource === undefined ? undefined : `    tokenEfficiencySource: ${JSON.stringify(row.tokenEfficiencySource)},`,
        row.tokenEfficiencyBenchmark === undefined ? undefined : `    tokenEfficiencyBenchmark: ${JSON.stringify(row.tokenEfficiencyBenchmark)},`,
        row.tokenEfficiencyHarness === undefined ? undefined : `    tokenEfficiencyHarness: ${JSON.stringify(row.tokenEfficiencyHarness)},`,
        row.tokenEfficiencyModel === undefined ? undefined : `    tokenEfficiencyModel: ${JSON.stringify(row.tokenEfficiencyModel)},`,
        row.tokenEfficiencyFormula === undefined ? undefined : `    tokenEfficiencyFormula: ${JSON.stringify(row.tokenEfficiencyFormula)},`,
        row.benchmarkScore === undefined ? undefined : `    benchmarkScore: ${formatNumber(row.benchmarkScore)},`,
        row.inputTokens === undefined ? undefined : `    inputTokens: ${formatNumber(row.inputTokens)},`,
        row.answerTokens === undefined ? undefined : `    answerTokens: ${formatNumber(row.answerTokens)},`,
        row.reasoningTokens === undefined ? undefined : `    reasoningTokens: ${formatNumber(row.reasoningTokens)},`,
        row.outputTokens === undefined ? undefined : `    outputTokens: ${formatNumber(row.outputTokens)},`,
        row.evalCost === undefined ? undefined : `    evalCost: ${formatNumber(row.evalCost)},`,
        row.costPerSession === undefined ? undefined : `    costPerSession: ${formatNumber(row.costPerSession)},`,
        row.tokensPerSession === undefined ? undefined : `    tokensPerSession: ${formatNumber(row.tokensPerSession)},`,
        row.tokensPerDollar === undefined ? undefined : `    tokensPerDollar: ${formatNumber(row.tokensPerDollar)},`,
      ]
        .filter(Boolean)
        .join("\n");

      return `  {
    aliases: [${aliases}],
    name: ${JSON.stringify(row.name)},
    input: ${formatNumber(row.input)},
    output: ${formatNumber(row.output)},
${optional ? `${optional}\n` : ""}    source: ${JSON.stringify(row.source)},
  },`;
    })
    .join("\n");
}

function replaceGeneratedBlock(source, blockName, replacement) {
  const start = `  // BEGIN GENERATED ${blockName}`;
  const end = `  // END GENERATED ${blockName}`;
  const re = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  return source.replace(re, `${start}\n${replacement}\n${end}`);
}

const [opencodeData, terminalBench21, terminalBench20, artificialAnalysisTerminalBench21] = await Promise.all([
  fetchText(SOURCES.opencodeData),
  fetchText(SOURCES.terminalBench21),
  fetchText(SOURCES.terminalBench20),
  fetchText(SOURCES.artificialAnalysisTerminalBench21),
]);

const terminalBench21Rows = averageTerminalBenchRows(parseTerminalBenchRows(terminalBench21, {
  benchmark: "Terminal-Bench 2.1",
  source: SOURCES.terminalBench21,
}));
const terminalBench20Rows = averageTerminalBenchRows(parseTerminalBenchRows(terminalBench20, {
  benchmark: "Terminal-Bench 2.0",
  source: SOURCES.terminalBench20,
}));
const artificialAnalysisRows = parseArtificialAnalysisTerminalBench21(artificialAnalysisTerminalBench21);
const officialBenchmarkRows = [...terminalBench21Rows, ...terminalBench20Rows];
const artificialAnalysisBenchmarkFallbackRows = artificialAnalysisBenchmarkRows(artificialAnalysisRows, officialBenchmarkRows);
const benchmarkRows = [...officialBenchmarkRows, ...artificialAnalysisBenchmarkFallbackRows];
const costRows = mergeTokenEfficiency(
  parseOpenCodeCatalogCosts(opencodeData),
  artificialAnalysisRows,
  parseStatRows(opencodeData, "sessionCost"),
);

let source = readFileSync(scoreDataPath, "utf8");
source = replaceGeneratedBlock(source, "MODEL_BENCHMARKS", formatBenchmarkRows(benchmarkRows));
source = replaceGeneratedBlock(source, "MODEL_COSTS", formatCostRows(costRows));
writeFileSync(scoreDataPath, source);

console.log(`${terminalBench21Rows.length} Terminal-Bench 2.1 model averages written.`);
console.log(`${terminalBench20Rows.length} Terminal-Bench 2.0 model averages written.`);
console.log(`${artificialAnalysisRows.length} Artificial Analysis Terminal-Bench v2.1 efficiency rows parsed.`);
console.log(`${artificialAnalysisBenchmarkFallbackRows.length} Artificial Analysis Terminal-Bench v2.1 score fallback rows written.`);
console.log(`${costRows.length} OpenCode Data model cost rows written.`);
