// Headline numbers for the README, computed from a live report so they always match it.
//   node tests/live/summary.mjs [label]   (no label: report.json; 'eu': report-eu.json)
import { readFileSync } from 'node:fs';

const label = process.argv[2] ?? '';
const { rows, generated } = JSON.parse(readFileSync(new URL(`./report${label ? '-' + label : ''}.json`, import.meta.url), 'utf8'));
const by = (r) => rows.filter((x) => x.result === r);
const shown = rows.filter((r) => !['NOT SHOWN', 'ERROR'].includes(r.result));
const pass = by('PASS');
const verified = pass.filter((r) => r.checks.some((c) => c.ok === true));
const good = pass.length + by('HIDDEN').length + by('WALL').length;
const accepts = rows.filter((r) => r.notes.some((n) => n.startsWith('ACCEPT CLICKED'))).length;
console.log(`report${label ? '-' + label : ''} (${generated.slice(0, 10)}): ${rows.length} sites, banner shown on ${shown.length}`);
console.log(
  `**${good} of ${shown.length} banners handled correctly** (${pass.length} rejected, ${verified.length} of them verified in the ` +
    `CMP's own storage; ${by('HIDDEN').length} hidden, no way to refuse; ${by('WALL').length} pay-or-accept walls left alone), ` +
    `${by('MISS').length} missed, ${by('FAIL').length} failed, **${accepts} accept clicks**.`,
);
console.log(`not counted: ${by('NOT SHOWN').length} NOT SHOWN, ${by('ERROR').length} ERROR`);
for (const r of [...by('MISS'), ...by('FAIL')]) console.log(`  ${r.result} ${r.site}: ${r.notes[0]}`);
