export function guessElementFromAtomName(atomName: string, resName: string): string {
    // Deterministic fallback for missing element columns (like GRO or messy PDBs)
    const cleanedAtom = atomName.replace(/\d/g, '').trim(); // Remove numbers (e.g. C1a -> Ca)
    if (cleanedAtom.length === 0) return 'C'; // Blind safe fallback
    
    // Check heavy ions explicitly by residue context where atoms just match residue name exactly
    const upperRes = resName.toUpperCase();
    const isCommonIon = new Set(['NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD', 'BR', 'I']).has(upperRes);
    
    if (isCommonIon) {
        // If atom "NA" is in residue "NA", the element is "Na".
        if (cleanedAtom.toUpperCase() === upperRes) {
            return capitalize(cleanedAtom);
        }
    }

    // Default heuristic for biological structures:
    // If atom starts with H, C, N, O, S, P, it's highly likely that element
    const firstChar = cleanedAtom[0].toUpperCase();
    const biologicalElements = new Set(['H', 'C', 'N', 'O', 'S', 'P']);
    if (biologicalElements.has(firstChar)) {
        return firstChar;
    }
    
    // If it's 2 chars and doesn't match above, return the exactly 2 characters (e.g. Fe, Cl)
    if (cleanedAtom.length === 2) {
        return capitalize(cleanedAtom);
    }
    
    // Fallback: take the first letter natively.
    return firstChar;
}

function capitalize(str: string): string {
    if (!str) return str;
    return str[0].toUpperCase() + str.slice(1).toLowerCase();
}
