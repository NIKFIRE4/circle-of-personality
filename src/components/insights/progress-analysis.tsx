import { ArrowDownRight, ArrowUpRight, CircleDashed, Lightbulb, Minus } from "lucide-react";

import type { InsightTone, ProgressAnalysis } from "@/lib/insights-analysis";

const TONE_ICON: Record<InsightTone, typeof ArrowUpRight> = {
  strength: ArrowUpRight,
  lag: Minus,
  untouched: CircleDashed,
  trend: ArrowDownRight,
};

export function ProgressAnalysisPanel({ analysis }: { analysis: ProgressAnalysis }) {
  return (
    <article className="panel analysis-panel">
      <div className="panel-head" style={{ padding: 0 }}>
        <div>
          <span className="panel-title">Разбор недели</span>
          <span className="panel-caption">Наблюдения о времени, а не оценка вам</span>
        </div>
      </div>

      <p className="analysis-summary">{analysis.summary}</p>

      {analysis.hasEnoughData && (
        <ul className="analysis-list">
          {analysis.observations.map((observation) => {
            const Icon = observation.tone === "trend" && observation.headline.includes("больше")
              ? ArrowUpRight
              : TONE_ICON[observation.tone];

            return (
              <li className="analysis-item" data-tone={observation.tone} key={observation.id}>
                <span className="analysis-icon" aria-hidden="true"><Icon size={13} /></span>
                <div>
                  <strong>{observation.headline}</strong>
                  <span>{observation.detail}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {analysis.suggestion && (
        <div className="analysis-suggestion">
          <span className="analysis-icon" aria-hidden="true"><Lightbulb size={13} /></span>
          <div>
            <strong>{analysis.suggestion.headline}</strong>
            <span>{analysis.suggestion.detail}</span>
          </div>
        </div>
      )}
    </article>
  );
}
