"use client";

interface Props {
  tokensTotal: number;
  className?: string;
}

/** Rough cost estimate for compound-beta (Groq pricing ~$0.79/1M tokens blended) */
function estimateCost(tokens: number): string {
  const usd = (tokens / 1_000_000) * 0.79;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function TokenUsageBadge({ tokensTotal, className = "" }: Props) {
  if (tokensTotal === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-slate-500 ${className}`}>
      <span className="font-mono">{formatTokens(tokensTotal)}</span>
      <span>tokens</span>
      <span className="text-slate-400">·</span>
      <span className="text-slate-400">{estimateCost(tokensTotal)}</span>
    </span>
  );
}
