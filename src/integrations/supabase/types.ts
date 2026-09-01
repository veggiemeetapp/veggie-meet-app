export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          blockers: Json
          created_at: string
          effective_at: string | null
          id: string
          profile_id: string
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          blockers?: Json
          created_at?: string
          effective_at?: string | null
          id?: string
          profile_id: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          blockers?: Json
          created_at?: string
          effective_at?: string | null
          id?: string
          profile_id?: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          profile_id: string
          properties: Json
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          profile_id: string
          properties?: Json
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          profile_id?: string
          properties?: Json
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          checked_in_at: string | null
          created_at: string
          id: string
          joined_at: string
          meetup_id: string
          profile_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
        }
        Insert: {
          checked_in_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          meetup_id: string
          profile_id: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Update: {
          checked_in_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          meetup_id?: string
          profile_id?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_feedback: {
        Row: {
          app_version: string | null
          category: string
          client_token: string | null
          created_at: string
          id: string
          internal_note: string | null
          message: string
          profile_id: string | null
          route_template: string | null
          status: string
          surface: string
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          category: string
          client_token?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          message: string
          profile_id?: string | null
          route_template?: string | null
          status?: string
          surface: string
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          category?: string
          client_token?: string | null
          created_at?: string
          id?: string
          internal_note?: string | null
          message?: string
          profile_id?: string | null
          route_template?: string | null
          status?: string
          surface?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_deletions: {
        Row: {
          created_at: string
          deleted_by: string
          id: string
          message_id: string
          original_body: string
          sender_id: string
          source: string
        }
        Insert: {
          created_at?: string
          deleted_by: string
          id?: string
          message_id: string
          original_body: string
          sender_id: string
          source: string
        }
        Update: {
          created_at?: string
          deleted_by?: string
          id?: string
          message_id?: string
          original_body?: string
          sender_id?: string
          source?: string
        }
        Relationships: []
      }
      chat_participants: {
        Row: {
          chat_id: string
          id: string
          joined_at: string
          profile_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          joined_at?: string
          profile_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          joined_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          id: string
          meetup_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meetup_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meetup_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: true
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          country_code: string
          country_name: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          normalized_name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country_code: string
          country_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          normalized_name: string
          timezone: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          country_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          normalized_name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      community_place_detail_changes: {
        Row: {
          after_data: Json
          before_data: Json
          changed_at: string
          changed_by: string | null
          changed_fields: string[]
          community_place_id: string
          created_at: string
          id: string
          internal_note: string
          official_source_url: string | null
          reason: string | null
          source: string
          source_reference_id: string | null
        }
        Insert: {
          after_data?: Json
          before_data?: Json
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          community_place_id: string
          created_at?: string
          id?: string
          internal_note: string
          official_source_url?: string | null
          reason?: string | null
          source: string
          source_reference_id?: string | null
        }
        Update: {
          after_data?: Json
          before_data?: Json
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[]
          community_place_id?: string
          created_at?: string
          id?: string
          internal_note?: string
          official_source_url?: string | null
          reason?: string | null
          source?: string
          source_reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_place_detail_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_detail_changes_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_identity_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          community_place_id: string
          created_at: string
          id: string
          identity_review_id: string | null
          internal_reason: string | null
          new_address: string | null
          new_google_place_id: string | null
          new_latitude: number | null
          new_longitude: number | null
          old_address: string | null
          old_google_place_id: string | null
          old_latitude: number | null
          old_longitude: number | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          community_place_id: string
          created_at?: string
          id?: string
          identity_review_id?: string | null
          internal_reason?: string | null
          new_address?: string | null
          new_google_place_id?: string | null
          new_latitude?: number | null
          new_longitude?: number | null
          old_address?: string | null
          old_google_place_id?: string | null
          old_latitude?: number | null
          old_longitude?: number | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          community_place_id?: string
          created_at?: string
          id?: string
          identity_review_id?: string | null
          internal_reason?: string | null
          new_address?: string | null
          new_google_place_id?: string | null
          new_latitude?: number | null
          new_longitude?: number | null
          old_address?: string | null
          old_google_place_id?: string | null
          old_latitude?: number | null
          old_longitude?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "community_place_identity_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_history_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_history_identity_review_id_fkey"
            columns: ["identity_review_id"]
            isOneToOne: false
            referencedRelation: "community_place_identity_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_identity_reviews: {
        Row: {
          case_type: string | null
          community_place_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_candidate_id: string | null
          distance_meters: number | null
          evidence_summary: string | null
          id: string
          official_source_url: string | null
          old_address: string | null
          old_google_place_id: string | null
          old_latitude: number | null
          old_longitude: number | null
          old_name: string | null
          owner_note: string | null
          proposed_address: string | null
          proposed_google_place_id: string | null
          proposed_latitude: number | null
          proposed_longitude: number | null
          proposed_name: string | null
          public_action_applied: boolean
          related_report_id: string | null
          related_reverification_id: string | null
          relocation_confirmed: boolean
          result: string | null
          same_branch_confirmed: boolean
          same_business_confirmed: boolean
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          case_type?: string | null
          community_place_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_candidate_id?: string | null
          distance_meters?: number | null
          evidence_summary?: string | null
          id?: string
          official_source_url?: string | null
          old_address?: string | null
          old_google_place_id?: string | null
          old_latitude?: number | null
          old_longitude?: number | null
          old_name?: string | null
          owner_note?: string | null
          proposed_address?: string | null
          proposed_google_place_id?: string | null
          proposed_latitude?: number | null
          proposed_longitude?: number | null
          proposed_name?: string | null
          public_action_applied?: boolean
          related_report_id?: string | null
          related_reverification_id?: string | null
          relocation_confirmed?: boolean
          result?: string | null
          same_branch_confirmed?: boolean
          same_business_confirmed?: boolean
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          case_type?: string | null
          community_place_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_candidate_id?: string | null
          distance_meters?: number | null
          evidence_summary?: string | null
          id?: string
          official_source_url?: string | null
          old_address?: string | null
          old_google_place_id?: string | null
          old_latitude?: number | null
          old_longitude?: number | null
          old_name?: string | null
          owner_note?: string | null
          proposed_address?: string | null
          proposed_google_place_id?: string | null
          proposed_latitude?: number | null
          proposed_longitude?: number | null
          proposed_name?: string | null
          public_action_applied?: boolean
          related_report_id?: string | null
          related_reverification_id?: string | null
          relocation_confirmed?: boolean
          result?: string | null
          same_branch_confirmed?: boolean
          same_business_confirmed?: boolean
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_identity_reviews_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_reviews_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_reviews_created_candidate_id_fkey"
            columns: ["created_candidate_id"]
            isOneToOne: false
            referencedRelation: "place_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_reviews_related_report_id_fkey"
            columns: ["related_report_id"]
            isOneToOne: false
            referencedRelation: "community_place_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_reviews_related_reverification_id_fkey"
            columns: ["related_reverification_id"]
            isOneToOne: false
            referencedRelation: "community_place_reverifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_identity_reviews_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_photos: {
        Row: {
          community_place_id: string
          created_at: string
          created_by: string | null
          id: string
          is_cover: boolean
          sort_order: number
          storage_path: string
        }
        Insert: {
          community_place_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_cover?: boolean
          sort_order?: number
          storage_path: string
        }
        Update: {
          community_place_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_cover?: boolean
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_photos_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_reports: {
        Row: {
          additional_details: string | null
          community_place_id: string
          created_at: string
          explanation: string
          id: string
          official_source_url: string | null
          owner_note: string | null
          owner_resolution: string | null
          reason_code: string
          reporter_profile_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          additional_details?: string | null
          community_place_id: string
          created_at?: string
          explanation: string
          id?: string
          official_source_url?: string | null
          owner_note?: string | null
          owner_resolution?: string | null
          reason_code: string
          reporter_profile_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          additional_details?: string | null
          community_place_id?: string
          created_at?: string
          explanation?: string
          id?: string
          official_source_url?: string | null
          owner_note?: string | null
          owner_resolution?: string | null
          reason_code?: string
          reporter_profile_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_reports_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_reverifications: {
        Row: {
          community_place_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          details_status_observed: string | null
          google_status_observed: string | null
          id: string
          official_source_url: string | null
          owner_note: string | null
          place_action_applied: boolean
          result: string | null
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
          vegan_status_observed: string | null
        }
        Insert: {
          community_place_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          details_status_observed?: string | null
          google_status_observed?: string | null
          id?: string
          official_source_url?: string | null
          owner_note?: string | null
          place_action_applied?: boolean
          result?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          vegan_status_observed?: string | null
        }
        Update: {
          community_place_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          details_status_observed?: string | null
          google_status_observed?: string | null
          id?: string
          official_source_url?: string | null
          owner_note?: string | null
          place_action_applied?: boolean
          result?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
          vegan_status_observed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_place_reverifications_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_reverifications_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_reverifications_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_status_history: {
        Row: {
          action: string
          changed_by: string | null
          community_place_id: string
          created_at: string
          id: string
          new_is_active: boolean | null
          new_status: string
          note: string | null
          old_is_active: boolean | null
          old_status: string | null
        }
        Insert: {
          action: string
          changed_by?: string | null
          community_place_id: string
          created_at?: string
          id?: string
          new_is_active?: boolean | null
          new_status: string
          note?: string | null
          old_is_active?: boolean | null
          old_status?: string | null
        }
        Update: {
          action?: string
          changed_by?: string | null
          community_place_id?: string
          created_at?: string
          id?: string
          new_is_active?: boolean | null
          new_status?: string
          note?: string | null
          old_is_active?: boolean | null
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_place_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_status_history_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_suggestions: {
        Row: {
          address_text: string
          city_id: string | null
          created_at: string
          duplicate_of_candidate_id: string | null
          duplicate_of_place_id: string | null
          duplicate_of_suggestion_id: string | null
          id: string
          moderation_notes: string | null
          moderation_status: string
          official_source_url: string
          place_name: string
          promoted_candidate_id: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          submitted_at: string
          submitted_by: string
          submitter_note: string | null
          updated_at: string
          vegan_reason: string
        }
        Insert: {
          address_text: string
          city_id?: string | null
          created_at?: string
          duplicate_of_candidate_id?: string | null
          duplicate_of_place_id?: string | null
          duplicate_of_suggestion_id?: string | null
          id?: string
          moderation_notes?: string | null
          moderation_status?: string
          official_source_url: string
          place_name: string
          promoted_candidate_id?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_at?: string
          submitted_by: string
          submitter_note?: string | null
          updated_at?: string
          vegan_reason: string
        }
        Update: {
          address_text?: string
          city_id?: string | null
          created_at?: string
          duplicate_of_candidate_id?: string | null
          duplicate_of_place_id?: string | null
          duplicate_of_suggestion_id?: string | null
          id?: string
          moderation_notes?: string | null
          moderation_status?: string
          official_source_url?: string
          place_name?: string
          promoted_candidate_id?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_at?: string
          submitted_by?: string
          submitter_note?: string | null
          updated_at?: string
          vegan_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_suggestions_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_duplicate_of_candidate_id_fkey"
            columns: ["duplicate_of_candidate_id"]
            isOneToOne: false
            referencedRelation: "place_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_duplicate_of_place_id_fkey"
            columns: ["duplicate_of_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_duplicate_of_suggestion_id_fkey"
            columns: ["duplicate_of_suggestion_id"]
            isOneToOne: false
            referencedRelation: "community_place_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_promoted_candidate_id_fkey"
            columns: ["promoted_candidate_id"]
            isOneToOne: false
            referencedRelation: "place_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_suggestions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_vegan_classification_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          community_place_id: string
          created_at: string
          id: string
          internal_reason: string | null
          new_classification: string
          old_classification: string | null
          vegan_review_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          community_place_id: string
          created_at?: string
          id?: string
          internal_reason?: string | null
          new_classification: string
          old_classification?: string | null
          vegan_review_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          community_place_id?: string
          created_at?: string
          id?: string
          internal_reason?: string | null
          new_classification?: string
          old_classification?: string | null
          vegan_review_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_place_vegan_classification_hi_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_classification_histo_vegan_review_id_fkey"
            columns: ["vegan_review_id"]
            isOneToOne: false
            referencedRelation: "community_place_vegan_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_classification_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_vegan_reviews: {
        Row: {
          community_place_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          evidence_confidence: string | null
          evidence_source_url: string | null
          evidence_summary: string | null
          id: string
          identity_checks: string[]
          owner_note: string | null
          prior_classification: string | null
          product_checks: string[]
          public_action: string | null
          public_action_applied: boolean
          related_report_id: string | null
          related_reverification_id: string | null
          result: string | null
          resulting_classification: string | null
          source_checks: string[]
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          community_place_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          evidence_confidence?: string | null
          evidence_source_url?: string | null
          evidence_summary?: string | null
          id?: string
          identity_checks?: string[]
          owner_note?: string | null
          prior_classification?: string | null
          product_checks?: string[]
          public_action?: string | null
          public_action_applied?: boolean
          related_report_id?: string | null
          related_reverification_id?: string | null
          result?: string | null
          resulting_classification?: string | null
          source_checks?: string[]
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          community_place_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          evidence_confidence?: string | null
          evidence_source_url?: string | null
          evidence_summary?: string | null
          id?: string
          identity_checks?: string[]
          owner_note?: string | null
          prior_classification?: string | null
          product_checks?: string[]
          public_action?: string | null
          public_action_applied?: boolean
          related_report_id?: string | null
          related_reverification_id?: string | null
          result?: string | null
          resulting_classification?: string | null
          source_checks?: string[]
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_vegan_reviews_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_reviews_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_reviews_related_report_id_fkey"
            columns: ["related_report_id"]
            isOneToOne: false
            referencedRelation: "community_place_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_reviews_related_reverification_id_fkey"
            columns: ["related_reverification_id"]
            isOneToOne: false
            referencedRelation: "community_place_reverifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_vegan_reviews_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_place_visits: {
        Row: {
          community_place_id: string
          created_at: string
          distance_meters: number | null
          id: string
          location_accuracy_meters: number | null
          profile_id: string
          verification_method: string
          verification_status: string
          visited_at: string
        }
        Insert: {
          community_place_id: string
          created_at?: string
          distance_meters?: number | null
          id?: string
          location_accuracy_meters?: number | null
          profile_id: string
          verification_method?: string
          verification_status?: string
          visited_at?: string
        }
        Update: {
          community_place_id?: string
          created_at?: string
          distance_meters?: number | null
          id?: string
          location_accuracy_meters?: number | null
          profile_id?: string
          verification_method?: string
          verification_status?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_place_visits_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_place_visits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_places: {
        Row: {
          address: string
          business_status: string | null
          category: Database["public"]["Enums"]["place_category"]
          city_id: string | null
          cover_image_url: string | null
          created_at: string
          description: string | null
          google_maps_url: string | null
          google_place_id: string | null
          id: string
          image_rights_status: string
          is_active: boolean
          last_reverified_at: string | null
          latitude: number | null
          longitude: number | null
          maintenance_status: string
          meetups_this_month: number
          name: string
          neighborhood: string | null
          source: string
          status_changed_at: string | null
          status_changed_by: string | null
          status_note: string | null
          timezone: string | null
          upcoming_meetups_count: number
          updated_at: string
          veggie_classification: string | null
          veggie_reason: string | null
          veggies_visited_count: number
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          address?: string
          business_status?: string | null
          category?: Database["public"]["Enums"]["place_category"]
          city_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          image_rights_status?: string
          is_active?: boolean
          last_reverified_at?: string | null
          latitude?: number | null
          longitude?: number | null
          maintenance_status?: string
          meetups_this_month?: number
          name: string
          neighborhood?: string | null
          source?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_note?: string | null
          timezone?: string | null
          upcoming_meetups_count?: number
          updated_at?: string
          veggie_classification?: string | null
          veggie_reason?: string | null
          veggies_visited_count?: number
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          address?: string
          business_status?: string | null
          category?: Database["public"]["Enums"]["place_category"]
          city_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          image_rights_status?: string
          is_active?: boolean
          last_reverified_at?: string | null
          latitude?: number | null
          longitude?: number | null
          maintenance_status?: string
          meetups_this_month?: number
          name?: string
          neighborhood?: string | null
          source?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_note?: string | null
          timezone?: string | null
          upcoming_meetups_count?: number
          updated_at?: string
          veggie_classification?: string | null
          veggie_reason?: string | null
          veggies_visited_count?: number
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_places_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_places_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_places_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_conversation_clears: {
        Row: {
          cleared_at: string
          conversation_id: string
          created_at: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          cleared_at?: string
          conversation_id: string
          created_at?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          cleared_at?: string
          conversation_id?: string
          created_at?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_conversation_clears_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_conversation_clears_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          updated_at: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_conversations_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_conversations_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "dm_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_messages: {
        Row: {
          body: string
          client_token: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          invitation_id: string | null
          reactions_updated_at: string | null
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          client_token?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          invitation_id?: string | null
          reactions_updated_at?: string | null
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          client_token?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          invitation_id?: string | null
          reactions_updated_at?: string | null
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_messages_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "meetup_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          first_meetup_id: string | null
          friends_since: string | null
          id: string
          meetups_together_count: number
          profile_a_id: string
          profile_b_id: string
          requester_id: string | null
          status: Database["public"]["Enums"]["friendship_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_meetup_id?: string | null
          friends_since?: string | null
          id?: string
          meetups_together_count?: number
          profile_a_id: string
          profile_b_id: string
          requester_id?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_meetup_id?: string | null
          friends_since?: string | null
          id?: string
          meetups_together_count?: number
          profile_a_id?: string
          profile_b_id?: string
          requester_id?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_first_meetup_id_fkey"
            columns: ["first_meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_profile_a_id_fkey"
            columns: ["profile_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_profile_b_id_fkey"
            columns: ["profile_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interest_catalogue: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          group_key: string | null
          group_label: string | null
          group_sort: number
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          group_key?: string | null
          group_label?: string | null
          group_sort?: number
          id: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          group_key?: string | null
          group_label?: string | null
          group_sort?: number
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      interest_legacy_map: {
        Row: {
          interest_id: string
          legacy_key: string
        }
        Insert: {
          interest_id: string
          legacy_key: string
        }
        Update: {
          interest_id?: string
          legacy_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "interest_legacy_map_interest_id_fkey"
            columns: ["interest_id"]
            isOneToOne: false
            referencedRelation: "interest_catalogue"
            referencedColumns: ["id"]
          },
        ]
      }
      interest_migration_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          id: string
          legacy_value: string
          new_value: string | null
          profile_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          id?: string
          legacy_value: string
          new_value?: string | null
          profile_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          id?: string
          legacy_value?: string
          new_value?: string | null
          profile_id?: string | null
        }
        Relationships: []
      }
      meetup_completions: {
        Row: {
          completed_at: string
          completion_method: string
          created_at: string
          host_id: string
          id: string
          meetup_id: string
        }
        Insert: {
          completed_at?: string
          completion_method?: string
          created_at?: string
          host_id: string
          id?: string
          meetup_id: string
        }
        Update: {
          completed_at?: string
          completion_method?: string
          created_at?: string
          host_id?: string
          id?: string
          meetup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_completions_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_completions_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: true
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_feedback: {
        Row: {
          created_at: string
          experience_rating: Database["public"]["Enums"]["meetup_feedback_rating"]
          id: string
          meetup_id: string
          private_note: string | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          experience_rating: Database["public"]["Enums"]["meetup_feedback_rating"]
          id?: string
          meetup_id: string
          private_note?: string | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          experience_rating?: Database["public"]["Enums"]["meetup_feedback_rating"]
          id?: string
          meetup_id?: string
          private_note?: string | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_feedback_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_follow_up_state: {
        Row: {
          created_at: string
          dismissed_at: string | null
          id: string
          meetup_id: string
          profile_id: string
          prompted_at: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          meetup_id: string
          profile_id: string
          prompted_at?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          meetup_id?: string
          profile_id?: string
          prompted_at?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetup_follow_up_state_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_follow_up_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_invitations: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          joined_at: string | null
          meetup_id: string
          personal_message: string
          recipient_id: string
          sender_id: string
          status: Database["public"]["Enums"]["invitation_status"]
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          joined_at?: string | null
          meetup_id: string
          personal_message?: string
          recipient_id: string
          sender_id: string
          status?: Database["public"]["Enums"]["invitation_status"]
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          joined_at?: string | null
          meetup_id?: string
          personal_message?: string
          recipient_id?: string
          sender_id?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetup_invitations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_invitations_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_invitations_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_invitations_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_location_changes: {
        Row: {
          changed_at: string
          changed_by_profile_id: string | null
          id: string
          meaningful_change: boolean
          meetup_id: string
          new_address: string | null
          new_city_id: string | null
          new_community_place_id: string | null
          new_latitude: number | null
          new_location_mode: string | null
          new_location_name: string | null
          new_longitude: number | null
          new_timezone: string | null
          old_address: string | null
          old_city_id: string | null
          old_community_place_id: string | null
          old_latitude: number | null
          old_location_mode: string | null
          old_location_name: string | null
          old_longitude: number | null
          old_timezone: string | null
        }
        Insert: {
          changed_at?: string
          changed_by_profile_id?: string | null
          id?: string
          meaningful_change?: boolean
          meetup_id: string
          new_address?: string | null
          new_city_id?: string | null
          new_community_place_id?: string | null
          new_latitude?: number | null
          new_location_mode?: string | null
          new_location_name?: string | null
          new_longitude?: number | null
          new_timezone?: string | null
          old_address?: string | null
          old_city_id?: string | null
          old_community_place_id?: string | null
          old_latitude?: number | null
          old_location_mode?: string | null
          old_location_name?: string | null
          old_longitude?: number | null
          old_timezone?: string | null
        }
        Update: {
          changed_at?: string
          changed_by_profile_id?: string | null
          id?: string
          meaningful_change?: boolean
          meetup_id?: string
          new_address?: string | null
          new_city_id?: string | null
          new_community_place_id?: string | null
          new_latitude?: number | null
          new_location_mode?: string | null
          new_location_name?: string | null
          new_longitude?: number | null
          new_timezone?: string | null
          old_address?: string | null
          old_city_id?: string | null
          old_community_place_id?: string | null
          old_latitude?: number | null
          old_location_mode?: string | null
          old_location_name?: string | null
          old_longitude?: number | null
          old_timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetup_location_changes_changed_by_profile_id_fkey"
            columns: ["changed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_location_changes_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_location_changes_new_city_id_fkey"
            columns: ["new_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_location_changes_new_community_place_id_fkey"
            columns: ["new_community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_location_changes_old_city_id_fkey"
            columns: ["old_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_location_changes_old_community_place_id_fkey"
            columns: ["old_community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_qr_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          issuer_profile_id: string
          meetup_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          issuer_profile_id: string
          meetup_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          issuer_profile_id?: string
          meetup_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_qr_tokens_issuer_profile_id_fkey"
            columns: ["issuer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_qr_tokens_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_reports: {
        Row: {
          created_at: string
          details: string | null
          host_profile_id: string | null
          id: string
          meetup_id: string
          public_status: string
          reason: string
          reporter_profile_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          host_profile_id?: string | null
          id?: string
          meetup_id: string
          public_status?: string
          reason: string
          reporter_profile_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          host_profile_id?: string | null
          id?: string
          meetup_id?: string
          public_status?: string
          reason?: string
          reporter_profile_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_reports_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_reports_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_update_seen: {
        Row: {
          created_at: string
          id: string
          meetup_id: string
          profile_id: string
          seen_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meetup_id: string
          profile_id: string
          seen_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meetup_id?: string
          profile_id?: string
          seen_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_update_seen_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetup_update_seen_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetups: {
        Row: {
          additional_interest_ids: string[]
          address: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          capacity: number
          category: Database["public"]["Enums"]["meetup_category"]
          city_id: string | null
          city_name_snapshot: string | null
          community_place_id: string | null
          country_code_snapshot: string | null
          cover_image_url: string | null
          created_at: string
          custom_location_address: string | null
          custom_location_name: string | null
          date: string
          description: string
          end_time: string | null
          google_maps_url: string | null
          google_place_id: string | null
          host_id: string
          id: string
          latitude: number | null
          location_is_inferred: boolean
          location_name: string | null
          location_source: Database["public"]["Enums"]["location_source"] | null
          location_updated_at: string | null
          longitude: number | null
          migrated_at: string | null
          neighborhood: string | null
          primary_interest_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["meetup_status"]
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          additional_interest_ids?: string[]
          address?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          capacity?: number
          category?: Database["public"]["Enums"]["meetup_category"]
          city_id?: string | null
          city_name_snapshot?: string | null
          community_place_id?: string | null
          country_code_snapshot?: string | null
          cover_image_url?: string | null
          created_at?: string
          custom_location_address?: string | null
          custom_location_name?: string | null
          date: string
          description?: string
          end_time?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          host_id: string
          id?: string
          latitude?: number | null
          location_is_inferred?: boolean
          location_name?: string | null
          location_source?:
            | Database["public"]["Enums"]["location_source"]
            | null
          location_updated_at?: string | null
          longitude?: number | null
          migrated_at?: string | null
          neighborhood?: string | null
          primary_interest_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["meetup_status"]
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          additional_interest_ids?: string[]
          address?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          capacity?: number
          category?: Database["public"]["Enums"]["meetup_category"]
          city_id?: string | null
          city_name_snapshot?: string | null
          community_place_id?: string | null
          country_code_snapshot?: string | null
          cover_image_url?: string | null
          created_at?: string
          custom_location_address?: string | null
          custom_location_name?: string | null
          date?: string
          description?: string
          end_time?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          host_id?: string
          id?: string
          latitude?: number | null
          location_is_inferred?: boolean
          location_name?: string | null
          location_source?:
            | Database["public"]["Enums"]["location_source"]
            | null
          location_updated_at?: string | null
          longitude?: number | null
          migrated_at?: string | null
          neighborhood?: string | null
          primary_interest_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["meetup_status"]
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetups_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_primary_interest_id_fkey"
            columns: ["primary_interest_id"]
            isOneToOne: false
            referencedRelation: "interest_catalogue"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          chat_id: string
          client_token: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          reactions_updated_at: string | null
          sender_id: string | null
          type: Database["public"]["Enums"]["message_type"]
        }
        Insert: {
          body: string
          chat_id: string
          client_token?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reactions_updated_at?: string | null
          sender_id?: string | null
          type?: Database["public"]["Enums"]["message_type"]
        }
        Update: {
          body?: string
          chat_id?: string
          client_token?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reactions_updated_at?: string | null
          sender_id?: string | null
          type?: Database["public"]["Enums"]["message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          community: boolean
          connection_accepted: boolean
          connection_requests: boolean
          created_at: string
          follow_up: boolean
          meetup_invitations: boolean
          meetup_reminders: boolean
          meetup_updates: boolean
          messages: boolean
          profile_id: string
          updated_at: string
        }
        Insert: {
          community?: boolean
          connection_accepted?: boolean
          connection_requests?: boolean
          created_at?: string
          follow_up?: boolean
          meetup_invitations?: boolean
          meetup_reminders?: boolean
          meetup_updates?: boolean
          messages?: boolean
          profile_id: string
          updated_at?: string
        }
        Update: {
          community?: boolean
          connection_accepted?: boolean
          connection_requests?: boolean
          created_at?: string
          follow_up?: boolean
          meetup_invitations?: boolean
          meetup_reminders?: boolean
          meetup_updates?: boolean
          messages?: boolean
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          dedup_key: string
          destination_id: string | null
          destination_type: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          read_at: string | null
          recipient_id: string
          title: string | null
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          dedup_key: string
          destination_id?: string | null
          destination_type?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id: string
          title?: string | null
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          dedup_key?: string
          destination_id?: string | null
          destination_type?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id?: string
          title?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_allowlist: {
        Row: {
          auth_user_id: string
          created_at: string
          note: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          note?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          note?: string | null
        }
        Relationships: []
      }
      place_candidates: {
        Row: {
          business_status: string | null
          category: Database["public"]["Enums"]["place_category"] | null
          city_id: string | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          district: string | null
          google_display_name: string | null
          google_formatted_address: string | null
          google_maps_url: string | null
          google_place_id: string | null
          google_primary_type: string | null
          google_website_url: string | null
          group_suitability: string | null
          id: string
          image_rights_status: string
          image_source: string | null
          latitude: number | null
          longitude: number | null
          public_address: string | null
          public_display_name: string | null
          published_at: string | null
          published_place_id: string | null
          review_order: number | null
          source: string
          updated_at: string
          veggie_classification: string | null
          veggie_reason: string | null
          verification_notes: string | null
          verification_status: string
        }
        Insert: {
          business_status?: string | null
          category?: Database["public"]["Enums"]["place_category"] | null
          city_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          district?: string | null
          google_display_name?: string | null
          google_formatted_address?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          google_primary_type?: string | null
          google_website_url?: string | null
          group_suitability?: string | null
          id?: string
          image_rights_status?: string
          image_source?: string | null
          latitude?: number | null
          longitude?: number | null
          public_address?: string | null
          public_display_name?: string | null
          published_at?: string | null
          published_place_id?: string | null
          review_order?: number | null
          source?: string
          updated_at?: string
          veggie_classification?: string | null
          veggie_reason?: string | null
          verification_notes?: string | null
          verification_status?: string
        }
        Update: {
          business_status?: string | null
          category?: Database["public"]["Enums"]["place_category"] | null
          city_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          district?: string | null
          google_display_name?: string | null
          google_formatted_address?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          google_primary_type?: string | null
          google_website_url?: string | null
          group_suitability?: string | null
          id?: string
          image_rights_status?: string
          image_source?: string | null
          latitude?: number | null
          longitude?: number | null
          public_address?: string | null
          public_display_name?: string | null
          published_at?: string | null
          published_place_id?: string | null
          review_order?: number | null
          source?: string
          updated_at?: string
          veggie_classification?: string | null
          veggie_reason?: string | null
          verification_notes?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_candidates_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "place_candidates_published_place_id_fkey"
            columns: ["published_place_id"]
            isOneToOne: false
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_onboarding_state: {
        Row: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          first_meaningful_action_at: string | null
          first_meaningful_action_entity_id: string | null
          first_meaningful_action_type: string | null
          onboarding_version: number
          profile_id: string
          skipped_steps: string[]
          started_at: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: string[]
          current_step?: string
          first_meaningful_action_at?: string | null
          first_meaningful_action_entity_id?: string | null
          first_meaningful_action_type?: string | null
          onboarding_version?: number
          profile_id: string
          skipped_steps?: string[]
          started_at?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_steps?: string[]
          current_step?: string
          first_meaningful_action_at?: string | null
          first_meaningful_action_entity_id?: string | null
          first_meaningful_action_type?: string | null
          onboarding_version?: number
          profile_id?: string
          skipped_steps?: string[]
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_onboarding_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_preferences: {
        Row: {
          created_at: string
          distance_unit: string
          location_permission_asked_at: string | null
          location_permission_result: string | null
          notification_permission_asked_at: string | null
          notification_permission_result: string | null
          profile_id: string
          selected_city_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          distance_unit?: string
          location_permission_asked_at?: string | null
          location_permission_result?: string | null
          notification_permission_asked_at?: string | null
          notification_permission_result?: string | null
          profile_id: string
          selected_city_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          distance_unit?: string
          location_permission_asked_at?: string | null
          location_permission_result?: string | null
          notification_permission_asked_at?: string | null
          notification_permission_result?: string | null
          profile_id?: string
          selected_city_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_preferences_selected_city_id_fkey"
            columns: ["selected_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          bio: string
          community_guidelines_accepted_at: string | null
          created_at: string
          current_city: string | null
          deleted_at: string | null
          dietary_identity: string | null
          discovery_visible: boolean
          display_name: string
          home_city_id: string | null
          id: string
          interests: string[]
          is_active_host: boolean
          onboarding_completed: boolean
          pronouns: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          bio?: string
          community_guidelines_accepted_at?: string | null
          created_at?: string
          current_city?: string | null
          deleted_at?: string | null
          dietary_identity?: string | null
          discovery_visible?: boolean
          display_name?: string
          home_city_id?: string | null
          id?: string
          interests?: string[]
          is_active_host?: boolean
          onboarding_completed?: boolean
          pronouns?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          bio?: string
          community_guidelines_accepted_at?: string | null
          created_at?: string
          current_city?: string | null
          deleted_at?: string | null
          dietary_identity?: string | null
          discovery_visible?: boolean
          display_name?: string
          home_city_id?: string | null
          id?: string
          interests?: string[]
          is_active_host?: boolean
          onboarding_completed?: boolean
          pronouns?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_home_city_id_fkey"
            columns: ["home_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_feedback: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          expires_at: string
          feedback_type: string
          id: string
          profile_id: string
          reason_code: string | null
          surface: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          expires_at?: string
          feedback_type: string
          id?: string
          profile_id: string
          reason_code?: string | null
          surface?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          expires_at?: string
          feedback_type?: string
          id?: string
          profile_id?: string
          reason_code?: string | null
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_reports: {
        Row: {
          context_meetup_id: string | null
          created_at: string
          details: string | null
          id: string
          public_status: string
          reason: string
          reporter_profile_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          context_meetup_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          public_status?: string
          reason: string
          reporter_profile_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          context_meetup_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          public_status?: string
          reason?: string
          reporter_profile_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_reports_context_meetup_id_fkey"
            columns: ["context_meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      today_place_curation: {
        Row: {
          city_id: string
          community_place_id: string
          created_at: string
          featured_rank: number | null
          id: string
          state: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id: string
          community_place_id: string
          created_at?: string
          featured_rank?: number | null
          id?: string
          state?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: string
          community_place_id?: string
          created_at?: string
          featured_rank?: number | null
          id?: string
          state?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "today_place_curation_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "today_place_curation_community_place_id_fkey"
            columns: ["community_place_id"]
            isOneToOne: true
            referencedRelation: "community_places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "today_place_curation_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_profile_id: string
          blocker_profile_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_profile_id: string
          blocker_profile_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_profile_id?: string
          blocker_profile_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_profile_id_fkey"
            columns: ["blocked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_profile_id_fkey"
            columns: ["blocker_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          conversation_id: string | null
          created_at: string
          details: string | null
          id: string
          public_status: string
          reason: string
          reported_message_created_at: string | null
          reported_message_id: string | null
          reported_message_snapshot: string | null
          reported_profile_id: string
          reported_sender_profile_id: string | null
          reporter_profile_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          public_status?: string
          reason: string
          reported_message_created_at?: string | null
          reported_message_id?: string | null
          reported_message_snapshot?: string | null
          reported_profile_id: string
          reported_sender_profile_id?: string | null
          reporter_profile_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          public_status?: string
          reason?: string
          reported_message_created_at?: string | null
          reported_message_id?: string | null
          reported_message_snapshot?: string | null
          reported_profile_id?: string
          reported_sender_profile_id?: string | null
          reporter_profile_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reported_profile_id_fkey"
            columns: ["reported_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_meetup_connections: {
        Row: {
          created_at: string
          id: string
          meetup_id: string
          profile_a_id: string
          profile_b_id: string
          scanned_by: string
          token_issuer_id: string
          verified_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meetup_id: string
          profile_a_id: string
          profile_b_id: string
          scanned_by: string
          token_issuer_id: string
          verified_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meetup_id?: string
          profile_a_id?: string
          profile_b_id?: string
          scanned_by?: string
          token_issuer_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_meetup_connections_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_meetup_connections_profile_a_id_fkey"
            columns: ["profile_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_meetup_connections_profile_b_id_fkey"
            columns: ["profile_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_meetup_connections_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_meetup_connections_token_issuer_id_fkey"
            columns: ["token_issuer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _detail_distance_m: {
        Args: { _lat1: number; _lat2: number; _lon1: number; _lon2: number }
        Returns: number
      }
      _detail_norm: { Args: { _t: string }; Returns: string }
      _detail_token_overlap: {
        Args: { _a: string; _b: string }
        Returns: number
      }
      _detail_url_ok: { Args: { _u: string }; Returns: boolean }
      _insert_notification: {
        Args: {
          _actor: string
          _body: string
          _dedup_key: string
          _destination_id: string
          _destination_type: string
          _entity_id: string
          _entity_type: string
          _metadata: Json
          _recipient: string
          _title: string
          _type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      _legit_hosted_meetup_ids: {
        Args: { _profile_id: string }
        Returns: {
          meetup_id: string
          occurred_at: string
        }[]
      }
      _legit_place_supports: {
        Args: { _profile_id: string }
        Returns: {
          community_place_id: string
          first_meetup_id: string
          first_supported_at: string
          last_supported_at: string
          visits: number
        }[]
      }
      _legit_verified_pairs: {
        Args: { _profile_id: string }
        Returns: {
          first_verified_at: string
          peer_profile_id: string
          source_meetup_id: string
        }[]
      }
      _meetup_place_integrity: { Args: { _meetup_id: string }; Returns: Json }
      _notify_place_report: {
        Args: {
          _place_name: string
          _recipient: string
          _report_id: string
          _status: string
        }
        Returns: undefined
      }
      _notify_place_suggestion: {
        Args: {
          _place_name: string
          _recipient: string
          _status: string
          _suggestion_id: string
        }
        Returns: undefined
      }
      _place_addr_key: { Args: { _t: string }; Returns: string }
      _place_brand_key: { Args: { _t: string }; Returns: string }
      _place_name_key: { Args: { _t: string }; Returns: string }
      _place_suggestion_match_context: {
        Args: { _suggestion_id: string }
        Returns: Json
      }
      _place_unaccent: { Args: { _t: string }; Returns: string }
      _suggestion_norm: { Args: { _t: string }; Returns: string }
      _valid_report_reason: {
        Args: { _code: string; _kind: string }
        Returns: boolean
      }
      accept_community_guidelines: { Args: never; Returns: string }
      accept_connection_request: {
        Args: { _friendship_id: string }
        Returns: Json
      }
      accept_meetup_current_place_location: {
        Args: { _meetup_id: string }
        Returns: Json
      }
      acknowledge_meetup_update: {
        Args: { _meetup_id: string }
        Returns: undefined
      }
      add_community_place_photo: {
        Args: { _place_id: string; _storage_path: string }
        Returns: Json
      }
      analytics_event_allowed: {
        Args: { _event_name: string }
        Returns: boolean
      }
      analytics_sanitize_properties: {
        Args: { _properties: Json }
        Returns: Json
      }
      are_connected: { Args: { _a: string; _b: string }; Returns: boolean }
      block_profile: { Args: { _blocked_profile_id: string }; Returns: Json }
      can_post_meetup_chat: { Args: { _chat_id: string }; Returns: boolean }
      can_read_meetup_chat: { Args: { _chat_id: string }; Returns: boolean }
      cancel_community_place_identity_review: {
        Args: { _place_id: string }
        Returns: Json
      }
      cancel_community_place_vegan_review: {
        Args: { _place_id: string }
        Returns: Json
      }
      cancel_connection_request: {
        Args: { _friendship_id: string }
        Returns: Json
      }
      cancel_meetup: {
        Args: { _meetup_id: string; _reason?: string }
        Returns: undefined
      }
      cancel_place_reverification: {
        Args: { _place_id: string }
        Returns: Json
      }
      canonical_interest_ids: { Args: { _values: string[] }; Returns: string[] }
      canonical_interest_labels: {
        Args: { _values: string[] }
        Returns: string[]
      }
      check_community_place_suggestion_duplicate: {
        Args: {
          _address_text: string
          _city_id: string
          _official_source_url: string
          _place_name: string
        }
        Returns: Json
      }
      check_in_to_community_place: {
        Args: {
          _accuracy: number
          _latitude: number
          _longitude: number
          _place_id: string
        }
        Returns: Json
      }
      check_in_to_meetup: { Args: { _meetup_id: string }; Returns: Json }
      complete_community_place_identity_review: {
        Args: {
          _acknowledge_large_move?: boolean
          _apply_google_identity?: boolean
          _apply_location?: boolean
          _apply_name?: boolean
          _apply_website?: boolean
          _case_type: string
          _confirm_public_action?: boolean
          _create_candidate?: boolean
          _evidence_summary?: string
          _official_source_url?: string
          _owner_note?: string
          _place_id: string
          _proposed_address?: string
          _proposed_google_place_id?: string
          _proposed_latitude?: number
          _proposed_longitude?: number
          _proposed_maps_url?: string
          _proposed_name?: string
          _proposed_neighborhood?: string
          _proposed_website_url?: string
          _related_report_id?: string
          _related_reverification_id?: string
          _relocation_confirmed?: boolean
          _result: string
          _same_branch_confirmed?: boolean
          _same_business_confirmed?: boolean
        }
        Returns: Json
      }
      complete_community_place_vegan_review: {
        Args: {
          _confirm_public_action?: boolean
          _evidence_confidence: string
          _evidence_source_url?: string
          _evidence_summary: string
          _identity_checks?: string[]
          _owner_note: string
          _place_id: string
          _product_checks?: string[]
          _public_action?: string
          _related_report_id?: string
          _related_reverification_id?: string
          _result: string
          _source_checks?: string[]
        }
        Returns: Json
      }
      complete_hosted_meetup: { Args: { _meetup_id: string }; Returns: Json }
      complete_onboarding: {
        Args: never
        Returns: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          first_meaningful_action_at: string | null
          first_meaningful_action_entity_id: string | null
          first_meaningful_action_type: string | null
          onboarding_version: number
          profile_id: string
          skipped_steps: string[]
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_place_reverification: {
        Args: {
          _apply_place_action?: boolean
          _details_status_observed?: string
          _google_status_observed?: string
          _official_source_url?: string
          _owner_note: string
          _place_id: string
          _result: string
          _vegan_status_observed?: string
        }
        Returns: Json
      }
      create_hosted_meetup: {
        Args: {
          _additional_interest_ids?: string[]
          _address: string
          _capacity: number
          _category: string
          _city_id: string
          _community_place_id: string
          _cover_image_url: string
          _date: string
          _description: string
          _end_time: string
          _latitude: number
          _location_name: string
          _longitude: number
          _neighborhood: string
          _primary_interest_id?: string
          _start_time: string
          _timezone: string
          _title: string
        }
        Returns: string
      }
      create_meetup_invitation: {
        Args: {
          _meetup_id: string
          _personal_message: string
          _recipient_id: string
        }
        Returns: string
      }
      current_profile_id: { Args: never; Returns: string }
      decline_connection_request: {
        Args: { _friendship_id: string }
        Returns: Json
      }
      decline_meetup_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      delete_community_place_photo: {
        Args: { _photo_id: string }
        Returns: Json
      }
      delete_dm_conversation_for_me: {
        Args: { _conversation_id: string }
        Returns: Json
      }
      delete_dm_message: { Args: { _message_id: string }; Returns: Json }
      delete_meetup_chat_message: {
        Args: { _message_id: string }
        Returns: Json
      }
      discovery_eligible_profile_ids: {
        Args: { _include_related?: boolean; _me: string }
        Returns: string[]
      }
      dismiss_meetup_follow_up: {
        Args: { _meetup_id: string }
        Returns: undefined
      }
      dm_cleared_at: {
        Args: { _conversation_id: string; _profile_id: string }
        Returns: string
      }
      dm_reaction_summary: {
        Args: { _me: string; _message_id: string }
        Returns: Json
      }
      edit_dm_message: {
        Args: { _body: string; _message_id: string }
        Returns: Json
      }
      edit_meetup_chat_message: {
        Args: { _body: string; _message_id: string }
        Returns: Json
      }
      eligible_upcoming_meetups_for_viewer: {
        Args: { _city_id: string; _me: string }
        Returns: {
          additional_interest_ids: string[]
          attendee_count: number
          capacity: number
          category: Database["public"]["Enums"]["meetup_category"]
          cover_image_url: string
          date: string
          end_at: string
          end_time: string
          host_id: string
          id: string
          is_attending: boolean
          is_host: boolean
          is_removed: boolean
          meetup_city_id: string
          primary_interest_id: string
          start_at: string
          start_time: string
          title: string
        }[]
      }
      get_active_cities: {
        Args: never
        Returns: {
          country_code: string
          country_name: string
          id: string
          latitude: number
          longitude: number
          name: string
          timezone: string
        }[]
      }
      get_beta_activation_summary: { Args: { _window?: string }; Returns: Json }
      get_beta_feedback_queue: {
        Args: { _limit?: number; _offset?: number; _status?: string }
        Returns: Json
      }
      get_beta_operational_failures: {
        Args: { _hours?: number; _limit?: number }
        Returns: Json
      }
      get_community_place_activity: {
        Args: { _before_at?: string; _before_id?: string; _limit?: number }
        Returns: Json
      }
      get_community_place_detail: { Args: { _place_id: string }; Returns: Json }
      get_community_place_detail_changes: {
        Args: { _place_id: string }
        Returns: Json
      }
      get_community_place_edit_workspace: {
        Args: { _place_id: string }
        Returns: Json
      }
      get_community_place_identity_review_workspace: {
        Args: {
          _place_id: string
          _report_id?: string
          _reverification_id?: string
        }
        Returns: Json
      }
      get_community_place_maintenance: { Args: never; Returns: Json }
      get_community_place_operations_dashboard: { Args: never; Returns: Json }
      get_community_place_status_history: {
        Args: { _place_id: string }
        Returns: Json
      }
      get_community_place_vegan_review_workspace: {
        Args: {
          _place_id: string
          _report_id?: string
          _reverification_id?: string
        }
        Returns: Json
      }
      get_community_places_discovery: {
        Args: { _city_id?: string; _include_all_cities?: boolean }
        Returns: Json
      }
      get_dm_message_reactions: {
        Args: { _conversation_id: string; _message_ids: string[] }
        Returns: Json
      }
      get_dm_thread: {
        Args: {
          _before_created_at?: string
          _before_id?: string
          _conversation_id: string
          _limit?: number
        }
        Returns: Json
      }
      get_host_meetup_summary: { Args: { _meetup_id: string }; Returns: Json }
      get_meet_next_candidates: { Args: { _limit?: number }; Returns: Json }
      get_meetup_chat_context: { Args: { _chat_id: string }; Returns: Json }
      get_meetup_chat_thread: {
        Args: {
          _before_created_at?: string
          _before_id?: string
          _chat_id: string
          _limit?: number
        }
        Returns: Json
      }
      get_meetup_group: { Args: { _meetup_id: string }; Returns: Json }
      get_meetup_lifecycle: { Args: { _meetup_id: string }; Returns: Json }
      get_meetup_message_reactions: {
        Args: { _chat_id: string; _message_ids: string[] }
        Returns: Json
      }
      get_meetup_place_context: { Args: { _meetup_id: string }; Returns: Json }
      get_member_report_queue: { Args: { _status?: string }; Returns: Json }
      get_my_blocked_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          block_id: string
          blocked_at: string
          display_name: string
          profile_id: string
        }[]
      }
      get_my_community_impact: { Args: never; Returns: Json }
      get_my_dm_inbox: { Args: never; Returns: Json }
      get_my_impact_history: {
        Args: {
          _cursor?: string
          _cursor_id?: string
          _limit?: number
          _type?: string
        }
        Returns: Json
      }
      get_my_location_context: { Args: never; Returns: Json }
      get_my_meetup_summary: { Args: { _meetup_id: string }; Returns: Json }
      get_my_onboarding_state: {
        Args: never
        Returns: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          first_meaningful_action_at: string | null
          first_meaningful_action_entity_id: string | null
          first_meaningful_action_type: string | null
          onboarding_version: number
          profile_id: string
          skipped_steps: string[]
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_pending_follow_up: { Args: never; Returns: Json }
      get_my_place_check_in_state: {
        Args: { _place_id: string }
        Returns: Json
      }
      get_my_place_reports: { Args: never; Returns: Json }
      get_my_place_suggestions: { Args: never; Returns: Json }
      get_my_plans: {
        Args: { _past_cursor?: string; _past_limit?: number }
        Returns: Json
      }
      get_my_profile: {
        Args: never
        Returns: {
          auth_user_id: string | null
          avatar_url: string | null
          bio: string
          community_guidelines_accepted_at: string | null
          created_at: string
          current_city: string | null
          deleted_at: string | null
          dietary_identity: string | null
          discovery_visible: boolean
          display_name: string
          home_city_id: string | null
          id: string
          interests: string[]
          is_active_host: boolean
          onboarding_completed: boolean
          pronouns: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_removal_details: {
        Args: { _meetup_id: string }
        Returns: {
          removal_reason: string
          removed_at: string
          removed_by: string
        }[]
      }
      get_my_report_detail: {
        Args: { _report_id: string; _subject_type: string }
        Returns: Json
      }
      get_my_reports: {
        Args: never
        Returns: {
          created_at: string
          details: string
          public_status: string
          reason: string
          report_id: string
          subject_id: string
          subject_label: string
          subject_type: string
        }[]
      }
      get_my_settings: { Args: never; Returns: Json }
      get_my_supported_places: { Args: never; Returns: Json }
      get_my_suppressed_profile_ids: { Args: never; Returns: string[] }
      get_my_today_experience: { Args: never; Returns: Json }
      get_my_you_summary: { Args: { _history_limit?: number }; Returns: Json }
      get_onboarding_starting_options: { Args: never; Returns: Json }
      get_or_create_dm: { Args: { _other_profile_id: string }; Returns: string }
      get_place_report_queue: { Args: never; Returns: Json }
      get_place_reverification_queue: { Args: never; Returns: Json }
      get_place_reverification_workspace: {
        Args: { _place_id: string }
        Returns: Json
      }
      get_place_suggestion_queue:
        | { Args: never; Returns: Json }
        | { Args: { _scope?: string }; Returns: Json }
      get_private_beta_health: { Args: never; Returns: Json }
      get_private_beta_integrity_health: { Args: never; Returns: Json }
      get_profile_connection_summary: {
        Args: { _target_profile_id: string }
        Returns: Json
      }
      get_public_community_impact: {
        Args: { _profile_id: string }
        Returns: Json
      }
      get_today_place_curation: { Args: { _city_id: string }; Returns: Json }
      get_veggie_profile_availability: {
        Args: { _target_profile_id: string }
        Returns: Json
      }
      hide_today_recommendation: {
        Args: {
          _entity_id: string
          _entity_type: string
          _reason_code?: string
        }
        Returns: undefined
      }
      is_allowed_meetup_cover: { Args: { _url: string }; Returns: boolean }
      is_approved_reaction_emoji: { Args: { _emoji: string }; Returns: boolean }
      is_blocked_between: { Args: { _a: string; _b: string }; Returns: boolean }
      is_blocked_with_me: { Args: { _profile_id: string }; Returns: boolean }
      is_chat_participant: { Args: { _chat_id: string }; Returns: boolean }
      is_dm_participant: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      is_meetup_member: { Args: { _meetup_id: string }; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_pair_blocked: { Args: { _other_profile_id: string }; Returns: boolean }
      is_safe_avatar_url: { Args: { _url: string }; Returns: boolean }
      is_valid_timezone: { Args: { _tz: string }; Returns: boolean }
      issue_meetup_qr_token: {
        Args: { _meetup_id: string }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      join_from_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      join_meetup: { Args: { _meetup_id: string }; Returns: string }
      leave_meetup: { Args: { _meetup_id: string }; Returns: undefined }
      legacy_meetup_category_for_interest: {
        Args: { _interest_id: string }
        Returns: Database["public"]["Enums"]["meetup_category"]
      }
      log_analytics_event: {
        Args: { _event_name: string; _properties?: Json }
        Returns: undefined
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_dm_read: { Args: { _conversation_id: string }; Returns: number }
      mark_invitation_viewed: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      mark_meetup_follow_up_viewed: {
        Args: { _meetup_id: string }
        Returns: undefined
      }
      meetup_chat_meetup_id: { Args: { _chat_id: string }; Returns: string }
      meetup_chat_post_block_reason: {
        Args: { _chat_id: string }
        Returns: string
      }
      meetup_end_at: {
        Args: {
          _date: string
          _end_time: string
          _start_time: string
          _timezone: string
        }
        Returns: string
      }
      meetup_has_ended: { Args: { _meetup_id: string }; Returns: boolean }
      meetup_in_check_in_window: {
        Args: { _meetup_id: string }
        Returns: string
      }
      meetup_interest_score: {
        Args: {
          _additional: string[]
          _primary: string
          _viewer_interests: string[]
        }
        Returns: number
      }
      meetup_reaction_summary: {
        Args: { _me: string; _message_id: string }
        Returns: Json
      }
      meetup_start_at: {
        Args: { _date: string; _start_time: string; _timezone: string }
        Returns: string
      }
      moderate_community_place_report: {
        Args: {
          _action: string
          _note?: string
          _place_action?: string
          _report_id: string
        }
        Returns: Json
      }
      moderate_place_suggestion: {
        Args: {
          _action: string
          _notes?: string
          _reason?: string
          _suggestion_id: string
        }
        Returns: Json
      }
      move_community_place_photo: {
        Args: { _direction: string; _photo_id: string }
        Returns: Json
      }
      normalize_community_place_photos: {
        Args: { _place_id: string }
        Returns: undefined
      }
      normalize_interests: { Args: { _interests: string[] }; Returns: string[] }
      normalize_today_featured_ranks: {
        Args: { _city_id: string }
        Returns: undefined
      }
      place_freshness_label: {
        Args: { _last_reverified_at: string; _verified_at: string }
        Returns: string
      }
      platform_avatar_token: { Args: { _seed: string }; Returns: string }
      profile_is_eligible: { Args: { _profile_id: string }; Returns: boolean }
      promote_place_suggestion_to_candidate: {
        Args: { _suggestion_id: string }
        Returns: Json
      }
      publish_place_candidate: {
        Args: { _candidate_id: string }
        Returns: string
      }
      record_first_meaningful_action: {
        Args: { _action_type: string; _entity_id: string }
        Returns: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          first_meaningful_action_at: string | null
          first_meaningful_action_entity_id: string | null
          first_meaningful_action_type: string | null
          onboarding_version: number
          profile_id: string
          skipped_steps: string[]
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_permission_result: {
        Args: { _kind: string; _result: string }
        Returns: undefined
      }
      reject_place_candidate: {
        Args: { _candidate_id: string; _notes?: string }
        Returns: undefined
      }
      remove_connection: { Args: { _friendship_id: string }; Returns: Json }
      remove_meetup_attendee: {
        Args: { _attendee_id: string; _meetup_id: string; _reason: string }
        Returns: undefined
      }
      reorder_today_featured_places: {
        Args: { _city_id: string; _ordered_place_ids: string[] }
        Returns: Json
      }
      report_and_block_profile: {
        Args: {
          _conversation_id?: string
          _details: string
          _reason: string
          _reported_profile_id: string
        }
        Returns: Json
      }
      report_meetup: {
        Args: { _details: string; _meetup_id: string; _reason: string }
        Returns: string
      }
      request_account_deletion: { Args: never; Returns: Json }
      resolve_interest_id: { Args: { _value: string }; Returns: string }
      resolve_viewer_city_id: { Args: { _profile_id: string }; Returns: string }
      reverify_community_place: {
        Args: {
          _note?: string
          _place_id: string
          _veggie_classification?: string
        }
        Returns: Json
      }
      save_onboarding_step: {
        Args: {
          _completed?: boolean
          _next_step?: string
          _skipped?: boolean
          _step: string
        }
        Returns: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          first_meaningful_action_at: string | null
          first_meaningful_action_entity_id: string | null
          first_meaningful_action_type: string | null
          onboarding_version: number
          profile_id: string
          skipped_steps: string[]
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_onboarding_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_all: {
        Args: {
          _city_id?: string
          _include_all_cities?: boolean
          _limit_per_type?: number
          _query: string
        }
        Returns: Json
      }
      search_community_places: {
        Args: {
          _categories?: string[]
          _city_id?: string
          _cursor?: string
          _include_all_cities?: boolean
          _limit?: number
          _neighborhood?: string
          _query: string
        }
        Returns: Json
      }
      search_meetups: {
        Args: {
          _attendance?: string
          _availability?: string
          _categories?: string[]
          _city_id?: string
          _cursor?: string
          _date_from?: string
          _date_to?: string
          _include_all_cities?: boolean
          _include_past?: boolean
          _limit?: number
          _query: string
        }
        Returns: Json
      }
      search_norm: { Args: { _t: string }; Returns: string }
      search_veggies: {
        Args: {
          _city_id?: string
          _cursor?: string
          _include_all_cities?: boolean
          _interests?: string[]
          _limit?: number
          _query: string
          _relationship?: string[]
        }
        Returns: Json
      }
      see_fewer_today_recommendations: {
        Args: {
          _entity_id: string
          _entity_type: string
          _reason_code?: string
        }
        Returns: undefined
      }
      send_connection_request: {
        Args: { _target_profile_id: string }
        Returns: Json
      }
      send_dm_message: {
        Args: {
          _body: string
          _client_token?: string
          _conversation_id: string
        }
        Returns: Json
      }
      send_meetup_chat_message: {
        Args: { _body: string; _chat_id: string; _client_token?: string }
        Returns: Json
      }
      set_community_place_active: {
        Args: { _active: boolean; _note: string; _place_id: string }
        Returns: Json
      }
      set_community_place_photo_cover: {
        Args: { _photo_id: string }
        Returns: Json
      }
      set_community_place_status: {
        Args: { _note?: string; _place_id: string; _status: string }
        Returns: Json
      }
      set_home_city: { Args: { _city_id: string }; Returns: Json }
      set_meetup_google_location_meta: {
        Args: {
          _google_maps_url: string
          _google_place_id: string
          _meetup_id: string
        }
        Returns: undefined
      }
      set_member_report_status: {
        Args: { _report_id: string; _status: string }
        Returns: Json
      }
      set_selected_city: { Args: { _city_id: string }; Returns: Json }
      set_today_place_state: {
        Args: { _place_id: string; _state: string }
        Returns: Json
      }
      shares_context_with: { Args: { _profile_id: string }; Returns: boolean }
      start_community_place_identity_review: {
        Args: { _place_id: string }
        Returns: Json
      }
      start_community_place_vegan_review: {
        Args: { _place_id: string }
        Returns: Json
      }
      start_place_reverification: { Args: { _place_id: string }; Returns: Json }
      submit_beta_feedback: {
        Args: {
          _app_version?: string
          _category: string
          _client_token?: string
          _message: string
          _route_template?: string
          _surface: string
        }
        Returns: string
      }
      submit_community_place_report: {
        Args: {
          _additional_details?: string
          _explanation: string
          _official_source_url?: string
          _place_id: string
          _reason_code: string
        }
        Returns: Json
      }
      submit_community_place_suggestion: {
        Args: {
          _address_text: string
          _city_id: string
          _official_source_url: string
          _place_name: string
          _submitter_note?: string
          _vegan_reason: string
        }
        Returns: Json
      }
      submit_dm_message_report: {
        Args: { _details: string; _message_id: string; _reason: string }
        Returns: string
      }
      submit_meetup_feedback: {
        Args: {
          _meetup_id: string
          _note: string
          _rating: Database["public"]["Enums"]["meetup_feedback_rating"]
        }
        Returns: string
      }
      submit_message_report: {
        Args: {
          _conversation_id: string
          _details: string
          _reason: string
          _reported_profile_id: string
        }
        Returns: string
      }
      submit_profile_report: {
        Args: {
          _conversation_id?: string
          _details: string
          _reason: string
          _reported_profile_id: string
        }
        Returns: string
      }
      submit_safety_report: {
        Args: { _context_meetup_id: string; _details: string; _reason: string }
        Returns: string
      }
      to_plan: { Args: { r: unknown }; Returns: Json }
      toggle_dm_message_reaction: {
        Args: { _emoji: string; _message_id: string }
        Returns: Json
      }
      toggle_meetup_message_reaction: {
        Args: { _emoji: string; _message_id: string }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      unaccent_fallback: { Args: { _t: string }; Returns: string }
      unblock_profile: { Args: { _blocked_profile_id: string }; Returns: Json }
      update_beta_feedback_status: {
        Args: { _feedback_id: string; _internal_note?: string; _status: string }
        Returns: Json
      }
      update_community_place_details: {
        Args: {
          _acknowledge_identity_risk?: boolean
          _address: string
          _category: string
          _description?: string
          _google_maps_url?: string
          _internal_note?: string
          _latitude?: number
          _longitude?: number
          _name: string
          _neighborhood: string
          _official_source_url?: string
          _place_id: string
          _source?: string
          _source_reference_id?: string
          _website_url?: string
        }
        Returns: Json
      }
      update_discovery_settings: {
        Args: {
          _home_city_id?: string
          _interests?: string[]
          _selected_city_id?: string
        }
        Returns: undefined
      }
      update_hosted_meetup: {
        Args: {
          _additional_interest_ids?: string[]
          _capacity: number
          _clear_cover?: boolean
          _community_place_id: string
          _cover_image_url: string
          _custom_location_address: string
          _custom_location_name: string
          _date: string
          _description: string
          _end_time: string
          _meetup_id: string
          _primary_interest_id?: string
          _start_time: string
          _title: string
        }
        Returns: undefined
      }
      update_meetup_location: {
        Args: {
          _address: string
          _city_id: string
          _community_place_id: string
          _latitude: number
          _location_name: string
          _location_source: Database["public"]["Enums"]["location_source"]
          _longitude: number
          _meetup_id: string
          _neighborhood: string
          _timezone: string
        }
        Returns: Json
      }
      update_my_profile: {
        Args: {
          _avatar_url?: string
          _bio?: string
          _clear_avatar?: boolean
          _dietary_identity?: string
          _display_name?: string
          _interests?: string[]
          _pronouns?: string
        }
        Returns: undefined
      }
      update_notification_preferences: { Args: { _prefs: Json }; Returns: Json }
      update_privacy_settings: {
        Args: { _discovery_visible?: boolean }
        Returns: undefined
      }
      update_profile_settings: {
        Args: {
          _avatar_url?: string
          _bio?: string
          _dietary_identity?: string
          _display_name?: string
          _pronouns?: string
        }
        Returns: undefined
      }
      verify_and_publish_place_candidate: {
        Args: { _candidate_id: string }
        Returns: string
      }
      verify_meetup_connection: { Args: { _token: string }; Returns: Json }
    }
    Enums: {
      attendance_status:
        | "joined"
        | "checked_in"
        | "attended"
        | "cancelled"
        | "removed"
      friendship_status:
        | "connected"
        | "pending"
        | "blocked"
        | "verified"
        | "removed"
      invitation_status: "invited" | "viewed" | "joined" | "declined"
      location_source:
        | "community_place"
        | "host_selected_city"
        | "custom_location"
        | "migrated_place"
        | "migrated_address"
        | "migrated_host_city"
        | "unknown"
      meetup_category:
        | "dinner"
        | "brunch"
        | "coffee"
        | "picnic"
        | "cooking"
        | "walk"
        | "workshop"
        | "other"
      meetup_feedback_rating: "great" | "okay" | "not_for_me"
      meetup_status: "upcoming" | "full" | "in_progress" | "past" | "cancelled"
      message_type: "user" | "system"
      notification_type:
        | "connection_request_received"
        | "connection_request_accepted"
        | "meetup_invitation_received"
        | "meetup_invitation_joined"
        | "meetup_updated"
        | "meetup_cancelled"
        | "meetup_attendee_removed"
        | "place_suggestion_under_review"
        | "place_suggestion_approved"
        | "place_suggestion_duplicate"
        | "place_suggestion_rejected"
        | "meetup_location_changed"
        | "meetup_location_needs_attention"
        | "community_place_report_under_review"
        | "community_place_report_resolved"
        | "community_place_report_dismissed"
        | "community_place_report_duplicate"
      place_category:
        | "restaurant"
        | "cafe"
        | "park"
        | "market"
        | "studio"
        | "venue"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_status: [
        "joined",
        "checked_in",
        "attended",
        "cancelled",
        "removed",
      ],
      friendship_status: [
        "connected",
        "pending",
        "blocked",
        "verified",
        "removed",
      ],
      invitation_status: ["invited", "viewed", "joined", "declined"],
      location_source: [
        "community_place",
        "host_selected_city",
        "custom_location",
        "migrated_place",
        "migrated_address",
        "migrated_host_city",
        "unknown",
      ],
      meetup_category: [
        "dinner",
        "brunch",
        "coffee",
        "picnic",
        "cooking",
        "walk",
        "workshop",
        "other",
      ],
      meetup_feedback_rating: ["great", "okay", "not_for_me"],
      meetup_status: ["upcoming", "full", "in_progress", "past", "cancelled"],
      message_type: ["user", "system"],
      notification_type: [
        "connection_request_received",
        "connection_request_accepted",
        "meetup_invitation_received",
        "meetup_invitation_joined",
        "meetup_updated",
        "meetup_cancelled",
        "meetup_attendee_removed",
        "place_suggestion_under_review",
        "place_suggestion_approved",
        "place_suggestion_duplicate",
        "place_suggestion_rejected",
        "meetup_location_changed",
        "meetup_location_needs_attention",
        "community_place_report_under_review",
        "community_place_report_resolved",
        "community_place_report_dismissed",
        "community_place_report_duplicate",
      ],
      place_category: [
        "restaurant",
        "cafe",
        "park",
        "market",
        "studio",
        "venue",
      ],
    },
  },
} as const
