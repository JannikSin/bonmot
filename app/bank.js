// Word bank loader. The bank ships with the app (same-origin fetch,
// service worker keeps it available offline).

let bank = null;

export async function loadBank() {
  if (bank) return bank;
  const res = await fetch("./data/en.json");
  if (!res.ok) throw new Error("Word bank failed to load: " + res.status);
  bank = await res.json();
  bank.byId = new Map(bank.words.map((w) => [w.id, w]));
  return bank;
}

export function romanTier(tier) {
  return ["", "I", "II", "III", "IV"][tier] || "";
}
