interface Props {
  description: string;
}

export function MeetupDescription({ description }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-charcoal">About this meetup</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-charcoal whitespace-pre-line">
        {description}
      </p>
    </div>
  );
}
