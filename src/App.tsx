import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

// Eagerly load the two most common landing routes so first paint after
// auth/onboarding does not pay a code-split cost.
import Today from "./screens/Today";
import Onboarding from "./screens/Onboarding";
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
const PlaceCheckIn = lazy(() => import("./screens/PlaceCheckIn"));
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
const OwnerPlaceVerification = lazy(() => import("./screens/OwnerPlaceVerification"));


function RequireOnboarded({ children }: { children: JSX.Element }) {
  const { session, profile, loading } = useAuth();

  if (loading) return null;

  // No session → onboarding/auth. We no longer honor the legacy
  // `veggiemeet_onboarded` localStorage flag: a stale flag on a shared or
  // signed-out device must never grant access to private routes.
  if (!session) return <Navigate to="/onboarding" replace />;

  // Signed-in users must have completed onboarding, including required steps.
  const completed = !!profile?.onboarding_completed;
  if (!completed) return <Navigate to="/onboarding" replace />;
  if (!profile?.dietary_identity)
    return <Navigate to="/onboarding?resume=dietary" replace />;
  if (!profile?.community_guidelines_accepted_at)
    return <Navigate to="/onboarding?resume=guidelines" replace />;
  return children;
}

const queryClient = new QueryClient();

// Helper so every private route gets the same auth+onboarding gate. Only
// `/onboarding`, the OAuth consent page, and the NotFound catch-all are
// intentionally public.
const gated = (el: JSX.Element) => <RequireOnboarded>{el}</RequireOnboarded>;

// Neutral suspense fallback while a lazy route chunk loads. Kept blank on
// purpose: individual screens render their own skeleton immediately after
// mount, so a shared spinner here would only cause a visual flicker.
const RouteFallback = () => <div aria-hidden className="min-h-dvh" />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppShell>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/" element={gated(<Today />)} />
                <Route path="/community" element={gated(<Community />)} />
                <Route path="/community/places" element={gated(<CommunityPlaces />)} />
                <Route path="/search" element={gated(<Search />)} />
                <Route path="/discover" element={<Navigate to="/community" replace />} />
                <Route path="/host" element={gated(<Host />)} />
                <Route path="/chats" element={gated(<Chats />)} />
                <Route path="/you" element={gated(<You />)} />
                <Route path="/you/edit" element={gated(<EditProfile />)} />
                <Route path="/meetup/:id" element={gated(<MeetupDetail />)} />
                <Route path="/meetup/:id/manage" element={gated(<MeetupManagement />)} />
                <Route path="/meetup/:id/summary" element={gated(<MeetupSummary />)} />
                <Route path="/join/:id" element={gated(<JoinConfirmation />)} />
                <Route path="/meetup-created/:id" element={gated(<MeetupCreated />)} />
                <Route path="/group/:id" element={gated(<MeetTheGroup />)} />
                <Route path="/chat/:id" element={gated(<MeetupChat />)} />
                <Route path="/checkin/:meetupId" element={gated(<CheckIn />)} />
                <Route path="/place/:id" element={gated(<CommunityPlaceDetail />)} />
                <Route path="/place/:id/checkin" element={gated(<PlaceCheckIn />)} />
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
                <Route path="/owner/places" element={gated(<OwnerPlaceVerification />)} />
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
