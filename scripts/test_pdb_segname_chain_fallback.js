#!/usr/bin/env node
/**
 * test_pdb_segname_chain_fallback.js
 *
 * Standalone parser unit test for the segment-name fallback fix.
 * No VS Code dependency — runs directly with `node`.
 *
 * Tests:
 *   A) CHARMM-GUI blank-chain PDB  → distinct effective chains via segname fallback
 *   B) Normal chain-ID PDB          → standard chain IDs used unchanged
 *
 * Usage:
 *   node scripts/test_pdb_segname_chain_fallback.js
 *
 * Exit 0 = all assertions passed
 * Exit 1 = one or more assertions failed
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Load the compiled parser (must run `npm run compile` first)
const { parsePdbTopology } = require(
  path.join(__dirname, '..', 'out', 'parsing', 'pdb.js')
);

const ROOT = path.join(__dirname, '..', '..' ); // md-preview root

const CHARMM_GUI_PDB = path.join(
  ROOT,
  'protein_membrane_complex',
  '1uun_rect_dmpc.pdb'
);
const NORMAL_PDB = path.join(
  ROOT,
  'outputs',
  'synthetic_complex',
  'synthetic_complex.pdb'
);

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

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parsePdbTopology(raw);
}

// ── A: CHARMM-GUI blank-chain PDB ────────────────────────────────────────────

console.log('\n═══ A: CHARMM-GUI blank-chain PDB (1uun_rect_dmpc.pdb) ═══');
const cgTopo = parseFile(CHARMM_GUI_PDB);

const cgChains   = cgTopo.chains;
const cgResidues = cgTopo.residueEntries;
const cgAtomCount = cgTopo.atomToChain.length;
const cgResidueChainIds = Array.from(new Set(cgResidues.map((res) => (res.chainId || '').trim())));

console.log(`  chains:   ${cgChains.length} → [${cgChains.slice(0, 12).join(', ')}${cgChains.length > 12 ? ', …' : ''}]`);
console.log(`  residues: ${cgResidues.length}`);
console.log(`  atoms:    ${cgAtomCount}`);
console.log(`  hasTopology: ${cgTopo.hasTopology}`);
console.log(`  residue chain IDs: ${cgResidueChainIds.length} → [${cgResidueChainIds.slice(0, 12).join(', ')}${cgResidueChainIds.length > 12 ? ', …' : ''}]`);

assert(cgTopo.hasTopology,            'hasTopology = true');
assert(cgAtomCount === 222227,        `atomCount = 222227 (got ${cgAtomCount})`);
assert(cgChains.length > 1,          `chains > 1 (got ${cgChains.length}) — collapse bug if 1`);
assert(cgChains.length >= 3,         `chains >= 3 (expect PROA..PROH + MEMB/TIP3; got ${cgChains.length})`);
assert(cgResidues.length > 100,      `residueEntries > 100 (got ${cgResidues.length})`);
assert(cgTopo.caIndices.length > 0,  `caIndices > 0 (polymer trace present)`);
assert(cgResidueChainIds.length > 1, `residueEntries chain IDs > 1 (got ${cgResidueChainIds.length})`);
assert(cgResidueChainIds.includes('PROA'), 'residueEntries include chainId PROA');
assert(!cgResidueChainIds.includes(''), 'residueEntries do not collapse to blank chain IDs');

// Verify that distinctive segname-derived chain labels appear
const chainSet = new Set(cgChains);
const hasProA = chainSet.has('PROA');
const hasMEMB = chainSet.has('MEMB');
console.log(`  PROA in chains: ${hasProA}, MEMB in chains: ${hasMEMB}`);
assert(hasProA, 'PROA chain present (segname fallback working)');

// ── B: Normal chain-ID PDB ───────────────────────────────────────────────────

console.log('\n═══ B: Normal chain-ID PDB (synthetic_complex.pdb) ═══');
const ncTopo = parseFile(NORMAL_PDB);

const ncChains   = ncTopo.chains;
const ncResidues = ncTopo.residueEntries;
const ncAtomCount = ncTopo.atomToChain.length;
const ncResidueChainIds = Array.from(new Set(ncResidues.map((res) => (res.chainId || '').trim())));

console.log(`  chains:   ${ncChains.length} → [${ncChains.join(', ')}]`);
console.log(`  residues: ${ncResidues.length}`);
console.log(`  atoms:    ${ncAtomCount}`);
console.log(`  residue chain IDs: ${ncResidueChainIds.length} → [${ncResidueChainIds.join(', ')}]`);

assert(ncTopo.hasTopology,           'hasTopology = true');
assert(ncAtomCount > 0,              `atomCount > 0 (got ${ncAtomCount})`);
assert(ncChains.length >= 1,         `chains >= 1 (got ${ncChains.length})`);
// For a normal PDB the standard chain IDs (e.g. 'A') must be used, not segname
const hasChainA = ncChains.includes('A');
assert(hasChainA,                    'Chain "A" (standard chain ID) present — not overridden by segname');
assert(!ncChains.includes('_'),      'No collapsed fallback chain "_" for normal PDB');
assert(ncResidueChainIds.includes('A'), 'residueEntries include chainId "A" for normal PDB');

// ── Result ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
if (failures === 0) {
  console.log('✅  ALL ASSERTIONS PASSED');
  process.exit(0);
} else {
  console.error(`❌  ${failures} ASSERTION(S) FAILED`);
  process.exit(1);
}
