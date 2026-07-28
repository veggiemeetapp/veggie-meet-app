import { useState } from "react";
import { Flag, MoreVertical, Shield } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportProfileDialog } from "./ReportProfileDialog";
import { BlockProfileDialog } from "./BlockProfileDialog";

export function ProfileSafetyMenu({
  profileId,
  displayName,
  onBlocked,
}: {
  profileId: string;
  displayName: string;
  onBlocked?: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Safety options for ${displayName}`}
            className="w-9 h-9 -mr-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="w-4 h-4 mr-2" />
            Report Veggie
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setBlockOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Shield className="w-4 h-4 mr-2" />
            Block Veggie
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportProfileDialog
        profileId={profileId}
        displayName={displayName}
        open={reportOpen}
        onOpenChange={setReportOpen}
        onBlocked={onBlocked}
      />
      <BlockProfileDialog
        profileId={profileId}
        displayName={displayName}
        open={blockOpen}
        onOpenChange={setBlockOpen}
        onBlocked={onBlocked}
      />
    </>
  );
}
