interface Props {
  label: string | null;
}
export function ResultReasonPill({ label }: Props) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-soft-green px-2 py-0.5 text-[10px] font-semibold text-primary">
      {label}
    </span>
  );
}
