import { Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, PrimaryButton } from "@/components/app";

export function FindFriendsCTA() {
  return (
    <Card className="mx-5 bg-soft-green border-primary/10">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-charcoal">Find Veggie Friends</h3>
          <p className="text-sm text-charcoal-muted mt-0.5">
            Meet people nearby who share your values.
          </p>
        </div>
      </div>
      <Link to="/community" className="block mt-4">
        <PrimaryButton fullWidth size="md">
          Meet Veggies
        </PrimaryButton>
      </Link>
    </Card>
  );
}
