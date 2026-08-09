import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";

export function TodayEmptyState() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Sparkles className="w-6 h-6" />}
      title="You’re all caught up."
      description="Explore Veggies, Community Places, or Meetups when you’re ready."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => navigate("/search")} className="rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold">Search VeggieMeet</button>
          <button onClick={() => navigate("/network")} className="rounded-full bg-soft-green text-primary px-3 py-1.5 text-sm font-semibold">Discover Veggies</button>
          <button onClick={() => navigate("/community")} className="rounded-full bg-soft-green text-primary px-3 py-1.5 text-sm font-semibold">Explore Community</button>
        </div>
      }
    />
  );
}
