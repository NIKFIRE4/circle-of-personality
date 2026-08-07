"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FocusTask = { id: string; time: string; title: string; category: string; done: boolean };

export function TodayFocus({ initialTasks, totalTasks, initialCompleted }: { initialTasks: FocusTask[]; totalTasks: number; initialCompleted: number }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [completed, setCompleted] = useState(initialCompleted);
  const [error, setError] = useState("");
  const router = useRouter();

  async function toggle(id: string) {
    const current = tasks.find(task => task.id === id);
    if (!current) return;
    setError("");
    setTasks(items => items.map(task => task.id === id ? { ...task, done: !task.done } : task));
    setCompleted((value) => value + (current.done ? -1 : 1));
    const response = await fetch(`/api/events/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: current.done ? "PLANNED" : "COMPLETED" }) });
    if (!response.ok) {
      setTasks(items => items.map(task => task.id === id ? { ...task, done: current.done } : task));
      setCompleted((value) => value + (current.done ? 1 : -1));
      setError("Не удалось обновить задачу. Попробуйте ещё раз.");
    }
    else router.refresh();
  }

  return (
    <article className="panel">
      <div className="panel-head"><div><span className="panel-title">Фокус на сегодня</span><span className="panel-caption">{totalTasks} задач · {completed} выполнено</span></div><span className="eyebrow">{totalTasks ? Math.round(completed/totalTasks*100) : 0}%</span></div>
      <div className="focus-list">{tasks.length ? tasks.map(task => <div className="focus-row" key={task.id}><button className={`task-check ${task.done ? "done" : ""}`} onClick={()=>toggle(task.id)} aria-label={task.done ? "Вернуть задачу в план" : "Отметить выполненной"}>{task.done && <Check size={11} />}</button><span className="task-time">{task.time}</span><div className="task-copy"><strong>{task.title}</strong><span>{task.category}</span></div></div>) : <p className="subtle" style={{padding:"26px 10px",fontSize:11}}>На сегодня задач нет — оставьте место для отдыха или добавьте новую.</p>}</div>
      {error && <p className="auth-error" role="alert" style={{ padding: "0 21px 14px" }}>{error}</p>}
    </article>
  );
}
