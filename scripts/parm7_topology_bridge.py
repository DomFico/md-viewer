import json
import os
import sys
from typing import Any, Dict, List, Optional

import mdtraj as md

ION_RESIDUES = {
    'NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD', 'BR', 'I'
}
SOLVENT_RESIDUES = {
    'HOH', 'WAT', 'SOL', 'TIP3P', 'TIP4P', 'SPC', 'SPCE'
}
POLYMER_RESIDUES = {
    'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
    'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
    'ASH', 'AS4', 'GLH', 'GL4', 'CYM', 'CYX', 'LYN', 'HIP', 'HID', 'HIE',
    'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'RA', 'RC', 'RG', 'RU'
}
ELEMENT_BY_ATOM_PREFIX = {
    'CL': 'Cl',
    'BR': 'Br',
    'NA': 'Na',
    'MG': 'Mg',
    'CA': 'Ca',
    'ZN': 'Zn',
    'FE': 'Fe',
    'CU': 'Cu',
    'MN': 'Mn',
    'CO': 'Co',
    'NI': 'Ni',
    'CD': 'Cd',
    'SI': 'Si',
}


def chain_id_from_index(index: int) -> str:
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if index < len(alphabet):
        return alphabet[index]

    value = index
    parts: List[str] = []
    while value >= 0:
        parts.append(alphabet[value % len(alphabet)])
        value = (value // len(alphabet)) - 1
    return ''.join(reversed(parts))


def guess_element(atom_name: str, residue_name: str) -> str:
    cleaned = ''.join(ch for ch in atom_name.strip().upper() if ch.isalpha())
    if len(cleaned) >= 2:
        maybe_two = cleaned[:2]
        if maybe_two in ELEMENT_BY_ATOM_PREFIX:
            return ELEMENT_BY_ATOM_PREFIX[maybe_two]
    if len(cleaned) >= 1:
        return cleaned[0].upper()

    residue_upper = residue_name.strip().upper()
    if residue_upper in ION_RESIDUES:
        if len(residue_upper) == 1:
            return residue_upper
        if len(residue_upper) >= 2:
            return residue_upper[0] + residue_upper[1].lower()
    return 'C'


def residue_is_polymer(residue: Any, residue_name_upper: str) -> bool:
    if residue_name_upper in POLYMER_RESIDUES:
        return True

    if bool(getattr(residue, 'is_protein', False)):
        return True
    if bool(getattr(residue, 'is_nucleic', False)):
        return True
    return False


def residue_seq_number(residue: Any) -> int:
    res_seq = getattr(residue, 'resSeq', None)
    if isinstance(res_seq, int):
        return res_seq
    if isinstance(res_seq, str):
        try:
            return int(res_seq)
        except ValueError:
            pass
    return int(getattr(residue, 'index', 0)) + 1


def build_residue_components(topology: Any) -> List[List[int]]:
    residue_count = int(topology.n_residues)
    adjacency: List[set[int]] = [set() for _ in range(residue_count)]
    for bond in topology.bonds:
        res_a = int(bond.atom1.residue.index)
        res_b = int(bond.atom2.residue.index)
        if res_a == res_b:
            continue
        adjacency[res_a].add(res_b)
        adjacency[res_b].add(res_a)

    visited: set[int] = set()
    components: List[List[int]] = []
    for residue_id in range(residue_count):
        if residue_id in visited:
            continue
        stack = [residue_id]
        visited.add(residue_id)
        component: List[int] = []
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        components.append(sorted(component))
    components.sort(key=lambda comp: comp[0] if comp else 10**9)
    return components


def parse_parm7_topology(parm7_path: str) -> Dict[str, Any]:
    top = md.load_prmtop(parm7_path)
    atom_count = int(top.n_atoms)

    atom_names: List[str] = [''] * atom_count
    elements: List[str] = [''] * atom_count
    atom_to_residue: List[int] = [-1] * atom_count
    atom_to_chain: List[int] = [0] * atom_count

    residue_entries: List[Dict[str, Any]] = []
    chain_id_by_index: Dict[int, str] = {}

    ca_indices: List[int] = []
    ca_by_chain: Dict[int, List[Dict[str, int]]] = {}
    ligand_indices: List[int] = []
    ion_indices: List[int] = []
    ligand_ion_indices: List[int] = []
    bond_pairs: List[int] = []

    residue_components = build_residue_components(top)
    component_by_residue: Dict[int, int] = {}
    for component_index, component in enumerate(residue_components):
        for residue_id in component:
            component_by_residue[residue_id] = component_index

    use_component_chain_inference = int(top.n_chains) <= 1 and len(residue_components) > 1

    for residue in top.residues:
        chain_obj = getattr(residue, 'chain', None)
        chain_index = int(getattr(chain_obj, 'index', 0) or 0)
        if use_component_chain_inference:
            chain_index = component_by_residue.get(int(residue.index), chain_index)
        chain_id_raw: Optional[str] = None
        if chain_obj is not None:
            chain_id_raw = getattr(chain_obj, 'chain_id', None)
        if use_component_chain_inference:
            chain_id_raw = None
        chain_id = (chain_id_raw or '').strip() or chain_id_from_index(chain_index)
        chain_id_by_index[chain_index] = chain_id

        residue_name = str(getattr(residue, 'name', '') or 'UNK').strip() or 'UNK'
        residue_name_upper = residue_name.upper()
        res_seq = residue_seq_number(residue)

        is_ion = residue_name_upper in ION_RESIDUES
        is_solvent = residue_name_upper in SOLVENT_RESIDUES
        is_polymer = residue_is_polymer(residue, residue_name_upper)
        is_ligand = (not is_ion) and (not is_solvent) and (not is_polymer)

        residue_id = len(residue_entries)
        atom_indices: List[int] = []

        for atom in residue.atoms:
            atom_index = int(atom.index)
            atom_indices.append(atom_index)
            atom_to_residue[atom_index] = residue_id
            atom_to_chain[atom_index] = chain_index

            atom_name = str(getattr(atom, 'name', '') or '').strip()
            atom_names[atom_index] = atom_name

            atom_element = getattr(atom, 'element', None)
            if atom_element is not None and getattr(atom_element, 'symbol', None):
                element_symbol = str(atom_element.symbol)
            else:
                element_symbol = guess_element(atom_name, residue_name)
            elements[atom_index] = element_symbol

            if is_ion:
                ion_indices.append(atom_index)
                ligand_ion_indices.append(atom_index)
            elif is_ligand:
                ligand_indices.append(atom_index)
                ligand_ion_indices.append(atom_index)

            if atom_name.upper() == 'CA' and is_polymer:
                ca_indices.append(atom_index)
                chain_list = ca_by_chain.setdefault(chain_index, [])
                chain_list.append({'index': atom_index, 'resSeq': res_seq})

        residue_entries.append({
            'chainId': chain_id,
            'chainIndex': chain_index,
            'resSeq': res_seq,
            'insertionCode': '',
            'resName': residue_name,
            'atomIndices': atom_indices,
            'isLigand': is_ligand,
            'isIon': is_ion,
            'isPolymer': is_polymer,
            'isSolvent': is_solvent,
        })

    for bond in top.bonds:
        atom_a = int(bond.atom1.index)
        atom_b = int(bond.atom2.index)
        bond_pairs.append(atom_a)
        bond_pairs.append(atom_b)

    if any(res_id < 0 for res_id in atom_to_residue):
        raise RuntimeError('Failed to map every atom to a residue while parsing .parm7 topology.')

    max_chain_index = max(chain_id_by_index.keys(), default=-1)
    chains = [chain_id_by_index.get(idx, chain_id_from_index(idx)) for idx in range(max_chain_index + 1)]

    ca_line_pairs: List[int] = []
    for chain_index in sorted(ca_by_chain.keys()):
        chain_entries = sorted(ca_by_chain[chain_index], key=lambda entry: (entry['resSeq'], entry['index']))
        for i in range(len(chain_entries) - 1):
            ca_line_pairs.append(chain_entries[i]['index'])
            ca_line_pairs.append(chain_entries[i + 1]['index'])

    return {
        'hasTopology': True,
        'bondPairs': bond_pairs,
        'caIndices': ca_indices,
        'caLinePairs': ca_line_pairs,
        'ligandIndices': ligand_indices,
        'ionIndices': ion_indices,
        'ligandIonIndices': ligand_ion_indices,
        'chains': chains,
        'atomToChain': atom_to_chain,
        'residueEntries': residue_entries,
        'atomToResidue': atom_to_residue,
        'atomNames': atom_names,
        'elements': elements,
        'chainInference': {
            'mode': 'residue_components' if use_component_chain_inference else 'topology_chain_ids',
            'topologyChainCount': int(top.n_chains),
            'componentCount': len(residue_components),
            'componentSizes': [len(component) for component in residue_components],
        },
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: parm7_topology_bridge.py <path_to_parm7>'}))
        return 1

    parm7_path = os.path.abspath(sys.argv[1])
    if not os.path.exists(parm7_path):
        print(json.dumps({'error': f'.parm7 file not found: {parm7_path}'}))
        return 1

    try:
        payload = parse_parm7_topology(parm7_path)
        print(json.dumps(payload))
        return 0
    except Exception as err:  # noqa: BLE001
        print(json.dumps({'error': str(err)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
