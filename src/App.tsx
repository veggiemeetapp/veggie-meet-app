import { safeBack } from "@/lib/navigation";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, RouteLoading } from "@/components/app";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { sanitizeInternalPath } from "@/lib/authRedirect";
import { NavigationBehavior } from "@/lib/navigation";
import { RequireValidIds } from "@/components/app/ResourceUnavailable";
import { RequireOwner } from "@/components/app/RequireOwner";
import { isRetryableRead } from "@/lib/errors";

// Eagerly load the two most common landing routes so first paint after
// auth/onboarding does not pay a code-split cost.
import Today from "./screens/Today";
import Onboarding from "./screens/Onboarding";
import Wo124bQa from "./screens/__Wo124bQa";

import NotFound from "./pages/NotFound";

// Everything else is route-level code split. Each screen ships in its own
// chunk and is fetched only when its route is visited, cutting the initial
// JS payload dramatically on cold cache.
const Community = lazy(() => import("./screens/Community"));
const CommunityPlaces = lazy(() => import("./screens/CommunityPlaces"));
const SupportedPlaces = lazy(() => import("./screens/SupportedPlaces"));
const Host = lazy(() => import("./screens/Host"));
const Chats = lazy(() => import("./screens/Chats"));
const You = lazy(() => import("./screens/You"));
const MeetupDetail = lazy(() => import("./screens/MeetupDetail"));
const MeetupManagement = lazy(() => import("./screens/MeetupManagement"));
const MeetupSummary = lazy(() => import("./screens/MeetupSummary"));
const JoinConfirmation = lazy(() => import("./screens/JoinConfirmation"));
const MeetupCreated = lazy(() => import("./screens/MeetupCreated"));
const MeetTheGroup = lazy(() => import("./screens/MeetTheGroup"));
const MeetupChat = lazy(() => import("./screens/MeetupChat"));
const EditProfile = lazy(() => import("./screens/EditProfile"));
const CheckIn = lazy(() => import("./screens/CheckIn"));
const CommunityPlaceDetail = lazy(() => import("./screens/CommunityPlaceDetail"));
// Legacy QR/mock place check-in screen (WO-048): removed. `/place/:id/checkin`
// now redirects to the canonical place detail page, which hosts the single
// location-verified check-in flow.
const VeggieNetwork = lazy(() => import("./screens/VeggieNetwork"));
const RelationshipDetail = lazy(() => import("./screens/RelationshipDetail"));
const VeggieProfile = lazy(() => import("./screens/VeggieProfile"));
const DirectMessage = lazy(() => import("./screens/DirectMessage"));
const Notifications = lazy(() => import("./screens/Notifications"));
const SafetyCenter = lazy(() => import("./screens/SafetyCenter"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const Search = lazy(() => import("./screens/Search"));
const Impact = lazy(() => import("./screens/Impact"));
const Plans = lazy(() => import("./screens/Plans"));
const Settings = lazy(() => import("./screens/Settings"));
const OwnerPlaceOperations = lazy(() => import("./screens/OwnerPlaceOperations"));
const OwnerPlaceReverify = lazy(() => import("./screens/OwnerPlaceReverify"));
const OwnerPlaceEditDetails = lazy(() => import("./screens/OwnerPlaceEditDetails"));
const OwnerPlacePhotos = lazy(() => import("./screens/OwnerPlacePhotos"));
const OwnerPlaceVeganReview = lazy(() => import("./screens/OwnerPlaceVeganReview"));
const OwnerPlaceIdentityReview = lazy(() => import("./screens/OwnerPlaceIdentityReview"));
const OwnerMemberReports = lazy(() => import("./screens/OwnerMemberReports"));
const OwnerBetaOperations = lazy(() => import("./screens/OwnerBetaOperations"));
const BetaFeedback = lazy(() => import("./screens/BetaFeedback"));
// WO-098: public password recovery destination — must never sit behind the
// onboarding guard, the member has no completed profile session yet.
const ResetPassword = lazy(() => import("./screens/ResetPassword"));

// WO-099: member-facing trust surfaces. These are intentionally PUBLIC — a
// visitor must be able to read them before creating an account, so they are
// mounted outside the auth/onboarding gate.
const Privacy = lazy(() => import("./screens/legal/Privacy"));
const Terms = lazy(() => import("./screens/legal/Terms"));
const CommunityGuidelines = lazy(() => import("./screens/legal/CommunityGuidelines"));




const SuggestPlace = lazy(() => import("./screens/SuggestPlace"));
const MyPlaceSuggestions = lazy(() => import("./screens/MyPlaceSuggestions"));
const ReportPlaceIssue = lazy(() => import("./screens/ReportPlaceIssue"));
const MyPlaceReports = lazy(() => import("./screens/MyPlaceReports"));


/**
 * WO-048 compatibility route. The legacy QR/mock place check-in screen is gone;
 * old `/place/:id/checkin` links land on the place detail page, where the single
 * location-verified Check In flow lives. No location permission is requested
 * during the redirect and history is replaced so Back skips the legacy URL.
 */
function LegacyPlaceCheckInRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={id ? `/place/${id}` : "/community/places"} replace />;
}



function RequireOnboarded({ children }: { children: JSX.Element }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  // No session → onboarding/auth. We no longer honor the legacy
  // `veggiemeet_onboarded` localStorage flag: a stale flag on a shared or
  // signed-out device must never grant access to private routes.
  // WO-073: remember the intended internal destination so a legitimate deep
  // link resumes after sign-in. The value is a router-produced relative path
  // and is re-sanitized before use; authorization is still enforced per route.
  if (!session) {
    const intended = sanitizeInternalPath(
      location.pathname + location.search + location.hash,
    );
    const target =
      intended && intended !== "/"
        ? `/onboarding?next=${encodeURIComponent(intended)}`
        : "/onboarding";
    return <Navigate to={target} replace />;
  }

  // Signed-in users must have completed onboarding, including required steps.
  const completed = !!profile?.onboarding_completed;
  if (!completed) return <Navigate to="/onboarding" replace />;
  if (!profile?.dietary_identity)
    return <Navigate to="/onboarding?resume=dietary" replace />;
  if (!profile?.community_guidelines_accepted_at)
    return <Navigate to="/onboarding?resume=guidelines" replace />;
  return children;
}


// Helper so every private route gets the same auth+onboarding gate. Only
// `/onboarding`, the OAuth consent page, and the NotFound catch-all are
// intentionally public.
// WO-082: every gated route also validates UUID-shaped route params before
// the screen mounts, so malformed deep links resolve to a neutral
// unavailable state instead of a database error.
// WO-083: explicit, bounded resilience policy. Previously this was a bare
// `new QueryClient()`, which retried every read three times — including 401s
// and deterministic domain rejections — and revalidated on every focus.
//
// Reads:  bounded retry (max 2) with exponential backoff, and never for auth
//         or deterministic 4xx/domain errors.
// Writes: no automatic retry at all. Mutations are retried only by an explicit
//         member action, because not every RPC is provably idempotent and a
//         destructive write must never be replayed blindly.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => failureCount < 2 && isRetryableRead(error),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    },
    mutations: {
      retry: false,
    },
  },
});


const gated = (el: JSX.Element) => (
  <RequireOnboarded>
    <RequireValidIds>{el}</RequireValidIds>
  </RequireOnboarded>
);

// Owner-only routes: auth + onboarding + id validation + owner gate.
const ownerGated = (el: JSX.Element) => gated(<RequireOwner>{el}</RequireOwner>);

// WO-121: branded suspense fallback while a lazy route chunk loads. It renders
// inside AppShell's <main>, so the app shell and bottom navigation stay visible
// and the selected tab updates instantly. A short delayed reveal keeps cached
// transitions flicker-free; screens still own their own data skeletons.
const RouteFallback = () => <RouteLoading />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <NavigationBehavior />
          <AppShell>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/__wo124b" element={<Wo124bQa />} />


                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/" element={gated(<Today />)} />
                <Route path="/community" element={gated(<Community />)} />
                <Route path="/community/places" element={gated(<CommunityPlaces />)} />
                <Route path="/community/places/suggest" element={gated(<SuggestPlace />)} />
                <Route path="/search" element={gated(<Search />)} />
                <Route path="/discover" element={<Navigate to="/community" replace />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/community-guidelines" element={<CommunityGuidelines />} />
                <Route path="/host" element={gated(<Host />)} />

                <Route path="/chats" element={gated(<Chats />)} />
                <Route path="/you" element={gated(<You />)} />
                <Route path="/you/edit" element={gated(<EditProfile />)} />
                <Route path="/you/places-supported" element={gated(<SupportedPlaces />)} />
                <Route path="/you/place-suggestions" element={gated(<MyPlaceSuggestions />)} />
                <Route path="/you/place-reports" element={gated(<MyPlaceReports />)} />

                <Route path="/meetup/:id" element={gated(<MeetupDetail />)} />
                <Route path="/meetup/:id/manage" element={gated(<MeetupManagement />)} />
                <Route path="/meetup/:id/summary" element={gated(<MeetupSummary />)} />
                <Route path="/join/:id" element={gated(<JoinConfirmation />)} />
                <Route path="/meetup-created/:id" element={gated(<MeetupCreated />)} />
                <Route path="/group/:id" element={gated(<MeetTheGroup />)} />
                <Route path="/chat/:id" element={gated(<MeetupChat />)} />
                <Route path="/checkin/:meetupId" element={gated(<CheckIn />)} />
                <Route path="/place/:id" element={gated(<CommunityPlaceDetail />)} />
                <Route path="/place/:id/report" element={gated(<ReportPlaceIssue />)} />
                <Route path="/place/:id/checkin" element={gated(<LegacyPlaceCheckInRedirect />)} />

                <Route path="/network" element={gated(<VeggieNetwork />)} />
                <Route path="/network/:id" element={gated(<RelationshipDetail />)} />
                <Route path="/veggie/:id" element={gated(<VeggieProfile />)} />
                <Route path="/dm/user/:otherProfileId" element={gated(<DirectMessage />)} />
                <Route path="/dm/:conversationId" element={gated(<DirectMessage />)} />
                <Route path="/notifications" element={gated(<Notifications />)} />
                <Route path="/plans" element={gated(<Plans />)} />
                <Route path="/impact" element={gated(<Impact />)} />
                <Route path="/impact/:tab" element={gated(<Impact />)} />
                <Route path="/safety" element={gated(<SafetyCenter />)} />
                <Route path="/settings" element={gated(<Settings />)} />
                <Route path="/settings/feedback" element={gated(<BetaFeedback />)} />
                <Route path="/owner/places" element={ownerGated(<OwnerPlaceOperations />)} />
                {/* WO-106: direct entry to the Today curation tab. */}
                <Route
                  path="/owner/places/today-curation"
                  element={<Navigate to="/owner/places?tab=today" replace />}
                />

                <Route path="/owner/beta" element={ownerGated(<OwnerBetaOperations />)} />
                <Route path="/owner/member-reports" element={ownerGated(<OwnerMemberReports />)} />

                <Route

                  path="/owner/places/:placeId/reverify"
                  element={ownerGated(<OwnerPlaceReverify />)}
                />
                <Route
                  path="/owner/places/:placeId/edit"
                  element={ownerGated(<OwnerPlaceEditDetails />)}
                />
                <Route
                  path="/owner/places/:placeId/photos"
                  element={ownerGated(<OwnerPlacePhotos />)}
                />
                <Route
                  path="/owner/places/:placeId/vegan-review"
                  element={ownerGated(<OwnerPlaceVeganReview />)}
                />
                <Route
                  path="/owner/places/:placeId/identity-review"
                  element={ownerGated(<OwnerPlaceIdentityReview />)}
                />



                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppShell>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
