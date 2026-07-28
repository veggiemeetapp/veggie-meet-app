import { MoreHorizontal, EyeOff, MinusCircle } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { hideRecommendation, seeFewerRecommendations, type EntityType } from "@/lib/today";

interface Props {
  entityType: EntityType;
  entityId: string;
  reasonCode?: string;
  label: string;
}

export function RecCardMenu({ entityType, entityId, reasonCode, label }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["today-experience"] });

  const run = async (fn: () => Promise<void>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      invalidate();
      toast({ description: successMsg });
    } catch {
      toast({ description: "Couldn’t save your feedback. Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More options for ${label}`}
        disabled={busy}
        className="inline-flex items-center justify-center min-w-11 min-h-11 rounded-full text-charcoal-muted hover:text-charcoal hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <MoreHorizontal className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => run(() => hideRecommendation(entityType, entityId, reasonCode), "Hidden from Today")}>
          <EyeOff className="w-4 h-4 mr-2" /> Hide this recommendation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run(() => seeFewerRecommendations(entityType, entityId, reasonCode), "We’ll show fewer like this")}>
          <MinusCircle className="w-4 h-4 mr-2" /> See fewer like this
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
