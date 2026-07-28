import { AlertCircle } from "lucide-react";
import { EmptyState, SecondaryButton } from "@/components/app";

interface Props {
  onRetry?: () => void;
}

export function TodayError({ onRetry }: Props) {
  return (
    <EmptyState
      icon={<AlertCircle className="w-6 h-6" />}
      title="Something went wrong"
      description="We couldn’t load today’s meetups. Please try again."
      action={
        onRetry ? (
          <SecondaryButton size="md" onClick={onRetry}>
            Try again
          </SecondaryButton>
        ) : undefined
      }
    />
  );
}
