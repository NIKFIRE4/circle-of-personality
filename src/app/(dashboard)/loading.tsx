/**
 * Every dashboard route renders dynamically, and Next.js skips prefetching a
 * dynamic route unless it has a loading boundary. Without this file a tab tap
 * waits on the full server round-trip with no feedback; with it the shell
 * appears immediately and the content streams in.
 */
export default function DashboardLoading() {
  return (
    <div className="page-content route-skeleton" aria-busy="true">
      <span className="sr-only" role="status">Загружаем раздел…</span>
      <div className="skeleton-heading" aria-hidden="true">
        <span className="skeleton-block skeleton-eyebrow" />
        <span className="skeleton-block skeleton-title" />
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        <div className="panel skeleton-panel skeleton-panel-lead" />
        <div className="panel skeleton-panel" />
        <div className="panel skeleton-panel" />
      </div>
    </div>
  );
}
