interface Props {
  label: string;
}

export function ReasonPill({ label }: Props) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full bg-soft-green px-2 py-0.5 text-[10px] font-semibold text-primary">
      {label}
    </span>
  );
}
