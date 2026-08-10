import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, SecondaryButton } from "@/components/app";

export function HostCTA() {
  return (
    <Card className="mx-5">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-card bg-accent text-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-charcoal">
            Create the Meetup you’d love to attend.
          </h3>
          <p className="text-sm text-charcoal-muted mt-0.5">
            Help bring Veggies together.
          </p>
        </div>
      </div>
      <Link to="/host" className="block mt-4">
        <SecondaryButton fullWidth size="md">
          Host a Meetup
        </SecondaryButton>
      </Link>
    </Card>
  );
}
