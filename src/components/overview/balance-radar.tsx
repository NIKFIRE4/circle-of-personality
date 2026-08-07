"use client";

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import type { BalanceMetric } from "@/lib/dashboard";

export function BalanceRadar({ data }: { data: BalanceMetric[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="69%">
        <PolarGrid stroke="rgba(255,255,255,.11)" gridType="polygon" />
        <PolarAngleAxis dataKey="name" tick={{ fill: "#77736b", fontSize: 8 }} />
        <Radar dataKey="value" stroke="#d7aa56" fill="#d7aa56" fillOpacity={.18} strokeWidth={1.4} />
        <Tooltip contentStyle={{ background: "#151411", border: "1px solid #33312c", borderRadius: 8, fontSize: 10 }} formatter={(value) => [`${value}%`, "Выполнение"]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
