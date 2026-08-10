import { safeBack } from "@/lib/navigation";
import { BackButton } from "@/components/app";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Leaf, MapPin, Trash2, UserRound } from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import { fetchRelationshipById, removeConnection } from "@/lib/relationships";
import { toast } from "sonner";

export default function RelationshipDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const relQuery = useQuery({
    queryKey: ["relationship", id, profile?.id],
    enabled: !!id && !!profile?.id,
    queryFn: () => fetchRelationshipById(profile!.id, id!),
  });

  async function handleRemove() {
    if (!relQuery.data) return;
    if (!confirm(`Remove ${relQuery.data.other.displayName} from your network?`)) return;
    try {
      await removeConnection(relQuery.data.id);
      toast.success("Connection removed");
      await qc.invalidateQueries({ queryKey: ["veggie-network", profile?.id] });
      safeBack(navigate, "/network");
    } catch {
      toast.error("Couldn't remove just now. Try again.");
    }
  }

  const rel = relQuery.data;
  const isVerified = rel?.status === "verified";

  return (
    <>
      <AppHeader
        title="Relationship"
        left={
          <BackButton fallback="/network" />
        }
      />
      <div className="px-5 pt-2 pb-8">
        {relQuery.isLoading ? (
          <Card className="h-56 animate-pulse" />
        ) : !rel ? (
          <EmptyState
            title="Relationship not found"
            description="It may have been removed."
          />
        ) : (
          <>
            <Card padding="lg" className="flex flex-col items-center text-center">
              <UserAvatar
                name={rel.other.displayName}
                src={rel.other.avatarUrl ?? undefined}
                size="xl"
              />
              <h2 className="mt-3 text-xl font-semibold text-charcoal">
                {rel.other.displayName}
              </h2>
              {rel.other.city && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-charcoal-muted">
                  <MapPin className="w-3.5 h-3.5" />
                  {rel.other.city}
                </p>
              )}
              <div className="mt-3">
                {isVerified ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-soft-green text-primary text-xs font-semibold">
                    Verified Connection <Leaf className="w-3 h-3" />
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-charcoal text-xs font-semibold">
                      Connected
                    </span>
                    <p className="mt-2 text-xs text-charcoal-muted">
                      Meet in person to verify your connection.
                    </p>
                  </>
                )}
              </div>
              {rel.other.bio && (
                <p className="mt-4 text-sm text-charcoal leading-relaxed max-w-xs">
                  {rel.other.bio}
                </p>
              )}
              {rel.other.interests.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {rel.other.interests.map((i) => (
                    <span
                      key={i}
                      className="px-2.5 py-0.5 rounded-full bg-soft-green/40 text-charcoal text-[11px] font-medium capitalize"
                    >
                      {i}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <div className="mt-5 space-y-2">
              <PrimaryButton
                fullWidth
                onClick={() => navigate(`/veggie/${rel.other.profileId}`)}
              >
                <UserRound className="w-4 h-4" />
                View Profile
              </PrimaryButton>
              <SecondaryButton fullWidth onClick={handleRemove}>
                <Trash2 className="w-4 h-4" />
                Remove Connection
              </SecondaryButton>
            </div>
          </>
        )}
      </div>
    </>
  );
}
