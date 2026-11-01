import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'data_references', 'soujihyo');
const outputPath = join(
  process.cwd(),
  'src',
  'core',
  'physics',
  'jmaTravelTimeTables.json'
);

function readRows(filePath) {
  return readFileSync(filePath, 'utf8').trim().split(/\r?\n/).map((line) => {
    const match = /^\s*P\s+([\d.]+)\s+S\s+([\d.]+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) throw new Error(`Invalid JMA travel-time row: ${filePath}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  });
}

const jma2001Rows = readRows(join(sourceRoot, 'tjma2001', 'tjma2001'));
const depthsKm = [...new Set(jma2001Rows.map((row) => row[2]))];
const distancesKm = [...new Set(jma2001Rows.map((row) => row[3]))];
const jma2001Lookup = new Map(
  jma2001Rows.map(([pTime, sTime, depth, distance]) => [
    `${depth}:${distance}`,
    [pTime, sTime]
  ])
);
const pTimesSec = [];
const sTimesSec = [];

for (const depth of depthsKm) {
  for (const distance of distancesKm) {
    const entry = jma2001Lookup.get(`${depth}:${distance}`);
    if (!entry) throw new Error(`Missing JMA2001 grid cell at depth ${depth}, distance ${distance}`);
    pTimesSec.push(entry[0]);
    sTimesSec.push(entry[1]);
  }
}

const jma2020a = [];
for (let depthTenthKm = 0; depthTenthKm <= 80; depthTenthKm++) {
  const filename = `tjma2020a.-${String(depthTenthKm * 100).padStart(5, '0')}`;
  const rows = readRows(join(sourceRoot, 'tjma2020a', filename))
    .filter((row) => row[2] === 0);
  if (
    rows.length !== distancesKm.length ||
    rows.some((row, index) => row[3] !== distancesKm[index])
  ) {
    throw new Error(`Unexpected JMA2020a grid at source depth ${depthTenthKm / 10} km`);
  }
  jma2020a.push(rows.flatMap(([pTime, sTime]) => [pTime, sTime]));
}

const output = {
  version: 1,
  jma2001: { depthsKm, distancesKm, pTimesSec, sTimesSec },
  jma2020a: {
    sourceDepthStepKm: 0.1,
    distancesKm,
    pAndSTimesSec: jma2020a
  }
};

writeFileSync(outputPath, JSON.stringify(output));
console.log(`Generated ${outputPath}`);
