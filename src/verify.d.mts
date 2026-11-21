export function overlap(claimed: string, real: string): number;
export function verify(claim: { title: string; url: string }, get?: typeof fetch): Promise<{ ok: true; title: string; authors: string[]; year: number | null; url: string } | { ok: false; reason: string }>;
