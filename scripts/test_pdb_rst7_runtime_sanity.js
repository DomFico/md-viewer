#!/usr/bin/env node
/**
 * test_pdb_rst7_runtime_sanity.js
 *
 * Standalone runtime sanity test for the PDB + RST7 pairing.
 * Validates that the PDB parser (topology) correctly processes the
 * 1uun_rect_dmpc.pdb used as topology for the .rst7 trajectory.
 *
 * This proves the parser fix doesn't break practical viewer loading.
 *
 * Usage:
 *   node scripts/test_pdb_rst7_runtime_sanity.js
 *
 * Exit 0 = all assertions passed
 * Exit 1 = one or more assertions failed
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const { parsePdbTopology } = require(
  path.join(__dirname, '..', 'out', 'parsing', 'pdb.js')
);

const ROOT = path.join(__dirname, '..', '..');

const TOPOLOGY_PDB = path.join(ROOT, 'protein_membrane_complex', '1uun_rect_dmpc.pdb');
const RST7_FILE    = path.join(ROOT, 'protein_membrane_complex', '1uun_rect_dmpc.rst7');

// ── helpers ──────────────────────────────────────────────────────────────────

let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅  ${message}`);
  } else {
    console.error(`  ❌  FAIL: ${message}`);
    failures++;
  }
}

// ── RST7 atom count ───────────────────────────────────────────────────────────

console.log('\n═══ RST7 file structure ═══');
const rst7Lines = fs.readFileSync(RST7_FILE, 'utf8').split('\n');
// Line 0: title, Line 1: atom count [, time]
const rst7AtomCount = parseInt(rst7Lines[1].trim().split(/\s+/)[0], 10);
console.log(`  RST7 atom count from header: ${rst7AtomCount}`);
assert(rst7AtomCount === 222227, `RST7 atom count = 222227 (got ${rst7AtomCount})`);

// ── PDB topology parse ───────────────────────────────────────────────────────

console.log('\n═══ PDB topology parse (used as .rst7 companion) ═══');
const t0 = Date.now();
const raw = fs.readFileSync(TOPOLOGY_PDB, 'utf8');
const topo = parsePdbTopology(raw);
const elapsed = Date.now() - t0;

const atomCount  = topo.atomToChain.length;
const chainCount = topo.chains.length;
const resCount   = topo.residueEntries.length;
const caCount    = topo.caIndices.length;
const residueChainIds = Array.from(new Set(topo.residueEntries.map((res) => (res.chainId || '').trim())));

console.log(`  parse time:   ${elapsed} ms`);
console.log(`  hasTopology:  ${topo.hasTopology}`);
console.log(`  atoms:        ${atomCount}`);
console.log(`  chains:       ${chainCount} → [${topo.chains.slice(0,12).join(', ')}${chainCount>12?', …':''}]`);
console.log(`  residues:     ${resCount}`);
console.log(`  CA indices:   ${caCount}`);
console.log(`  residue chain IDs: ${residueChainIds.length} → [${residueChainIds.slice(0,12).join(', ')}${residueChainIds.length>12?', …':''}]`);

assert(topo.hasTopology,           'hasTopology = true');
assert(atomCount === rst7AtomCount, `parsed atom count (${atomCount}) matches RST7 header (${rst7AtomCount})`);
assert(chainCount > 1,             `chains > 1 — chain grouping correctly separated (got ${chainCount})`);
assert(residueChainIds.length > 1, `residueEntries chain IDs > 1 (got ${residueChainIds.length})`);
assert(residueChainIds.includes('PROA'), 'residueEntries include chainId PROA');
assert(!residueChainIds.includes(''), 'residueEntries do not collapse to blank chain IDs');
assert(resCount > 100,             `residueEntries > 100 (got ${resCount})`);
assert(caCount > 0,                `caIndices > 0 — polymer backbone trace present (got ${caCount})`);

// Atom-to-residue mapping is valid for all atoms
let badMapping = 0;
for (let i = 0; i < atomCount; i++) {
  if (topo.atomToResidue[i] === undefined || topo.atomToResidue[i] >= resCount) {
    badMapping++;
  }
}
assert(badMapping === 0, `atomToResidue mapping valid for all ${atomCount} atoms (${badMapping} bad)`);

// ── Result ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
if (failures === 0) {
  console.log('✅  ALL ASSERTIONS PASSED — PDB+RST7 runtime sanity OK');
  process.exit(0);
} else {
  console.error(`❌  ${failures} ASSERTION(S) FAILED`);
  process.exit(1);
}
