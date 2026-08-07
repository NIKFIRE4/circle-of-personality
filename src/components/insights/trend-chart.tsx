"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TrendPoint = { label: string; value: number };

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d8a84f" stopOpacity={0.35} />
            <stop offset="1" stopColor="#d8a84f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,.055)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#605d57", fontSize: 8 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: "#605d57", fontSize: 8 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "#151411", border: "1px solid #33312c", borderRadius: 8, fontSize: 10 }}
          formatter={(value) => [`${value}%`, "Выполнено"]}
        />
        <Area type="monotone" dataKey="value" stroke="#d8a84f" strokeWidth={2} fill="url(#trend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
