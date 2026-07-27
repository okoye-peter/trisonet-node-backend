/**
 * Checks whether every name part of `registeredName` appears in `bankAccountName`.
 * Case-insensitive and order-insensitive, so a registered "Peter Benedict" matches
 * a bank account name of "Peter Benedict Thomas" (extra names on the bank side are fine),
 * but not "Peter Thomas" (missing "Benedict").
 */
export function bankAccountNameMatches(registeredName: string, bankAccountName: string): boolean {
    const normalize = (value: string) =>
        value
            .toLowerCase()
            .split(/[^a-z0-9]+/i)
            .filter(Boolean);

    const registeredParts = normalize(registeredName);
    const bankNameParts = new Set(normalize(bankAccountName));

    if (registeredParts.length === 0 || bankNameParts.size === 0) return false;

    return registeredParts.every(part => bankNameParts.has(part));
}
