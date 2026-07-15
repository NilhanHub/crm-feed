interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="em-title">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}
