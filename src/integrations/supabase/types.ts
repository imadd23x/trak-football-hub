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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          note: string
          organization_id: string
          target_coach_user_id: string | null
          target_squad_player_id: string | null
          target_type: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          note: string
          organization_id: string
          target_coach_user_id?: string | null
          target_squad_player_id?: string | null
          target_type: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          note?: string
          organization_id?: string
          target_coach_user_id?: string | null
          target_squad_player_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          join_code: string
          logo_url: string | null
          name: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          join_code: string
          logo_url?: string | null
          name: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          join_code?: string
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      pilot_config: {
        Row: {
          created_at: string
          id: boolean
          org_id: string | null
          starts_on: string
          weeks: number
        }
        Insert: {
          created_at?: string
          id?: boolean
          org_id?: string | null
          starts_on: string
          weeks?: number
        }
        Update: {
          created_at?: string
          id?: boolean
          org_id?: string | null
          starts_on?: string
          weeks?: number
        }
        Relationships: []
      }
      staff_compliance: {
        Row: {
          coach_user_id: string
          dbs_expiry: string | null
          dbs_status: string | null
          first_aid_expiry: string | null
          id: string
          license_expiry: string | null
          license_level: string | null
          notes: string | null
          organization_id: string
          safeguarding_completed: boolean
          updated_at: string
        }
        Insert: {
          coach_user_id: string
          dbs_expiry?: string | null
          dbs_status?: string | null
          first_aid_expiry?: string | null
          id?: string
          license_expiry?: string | null
          license_level?: string | null
          notes?: string | null
          organization_id: string
          safeguarding_completed?: boolean
          updated_at?: string
        }
        Update: {
          coach_user_id?: string
          dbs_expiry?: string | null
          dbs_status?: string | null
          first_aid_expiry?: string | null
          id?: string
          license_expiry?: string | null
          license_level?: string | null
          notes?: string | null
          organization_id?: string
          safeguarding_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      telemetry_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          role?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coach_assessment_notes: {
        Row: {
          assessment_id: string
          coach_user_id: string
          created_at: string
          id: string
          note: string
        }
        Insert: {
          assessment_id: string
          coach_user_id: string
          created_at?: string
          id?: string
          note: string
        }
        Update: {
          assessment_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_assessment_notes_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: true
            referencedRelation: "coach_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_assessments: {
        Row: {
          appearance: string | null
          attitude: number
          coach_name_snapshot: string | null
          coach_rating: number | null
          coach_user_id: string
          coachability: number
          consistency: number
          created_at: string | null
          flag: string | null
          id: string
          impact: number
          organization_id: string | null
          physical: number
          private_note: string | null
          session_id: string | null
          spirit: number
          squad_player_id: string
          tactical: number
          technical: number
          technique: number
          work_rate: number
          workrate: number
        }
        Insert: {
          appearance?: string | null
          attitude?: number
          coach_name_snapshot?: string | null
          coach_rating?: number | null
          coach_user_id: string
          coachability?: number
          consistency?: number
          created_at?: string | null
          flag?: string | null
          id?: string
          impact?: number
          organization_id?: string | null
          physical?: number
          private_note?: string | null
          session_id?: string | null
          spirit?: number
          squad_player_id: string
          tactical?: number
          technical?: number
          technique?: number
          work_rate?: number
          workrate?: number
        }
        Update: {
          appearance?: string | null
          attitude?: number
          coach_name_snapshot?: string | null
          coach_rating?: number | null
          coach_user_id?: string
          coachability?: number
          consistency?: number
          created_at?: string | null
          flag?: string | null
          id?: string
          impact?: number
          organization_id?: string | null
          physical?: number
          private_note?: string | null
          session_id?: string | null
          spirit?: number
          squad_player_id?: string
          tactical?: number
          technical?: number
          technique?: number
          work_rate?: number
          workrate?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_assessments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coach_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assessments_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_calendar_events: {
        Row: {
          coach_user_id: string
          created_at: string
          ends_at: string | null
          event_type: string
          id: string
          notes: string | null
          opponent: string | null
          published: boolean
          source: string
          starts_at: string
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          coach_user_id: string
          created_at?: string
          ends_at?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          opponent?: string | null
          published?: boolean
          source?: string
          starts_at: string
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          ends_at?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          opponent?: string | null
          published?: boolean
          source?: string
          starts_at?: string
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      coach_details: {
        Row: {
          coach_role: string | null
          created_at: string | null
          current_club: string | null
          id: string
          organization_id: string | null
          team: string | null
          user_id: string
        }
        Insert: {
          coach_role?: string | null
          created_at?: string | null
          current_club?: string | null
          id?: string
          organization_id?: string | null
          team?: string | null
          user_id: string
        }
        Update: {
          coach_role?: string | null
          created_at?: string | null
          current_club?: string | null
          id?: string
          organization_id?: string | null
          team?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coach_sessions: {
        Row: {
          coach_user_id: string
          competition: string | null
          created_at: string | null
          id: string
          notes: string | null
          session_date: string | null
          session_type: string
          title: string
          training_type: string | null
          venue: string | null
        }
        Insert: {
          coach_user_id: string
          competition?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          session_type?: string
          title: string
          training_type?: string | null
          venue?: string | null
        }
        Update: {
          coach_user_id?: string
          competition?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          session_type?: string
          title?: string
          training_type?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          age_group: string
          assists: number
          body_condition: string | null
          card_received: string | null
          competition: string
          computed_rating: number
          created_at: string | null
          goals: number
          id: string
          logged_by: string | null
          logged_by_role: string | null
          match_date: string | null
          minutes_played: number
          opponent: string | null
          opponent_score: number
          position: string
          self_rating: string | null
          team_score: number
          user_id: string
          venue: string
        }
        Insert: {
          age_group: string
          assists?: number
          body_condition?: string | null
          card_received?: string | null
          competition: string
          computed_rating?: number
          created_at?: string | null
          goals?: number
          id?: string
          logged_by?: string | null
          logged_by_role?: string | null
          match_date?: string | null
          minutes_played?: number
          opponent?: string | null
          opponent_score?: number
          position: string
          self_rating?: string | null
          team_score?: number
          user_id: string
          venue: string
        }
        Update: {
          age_group?: string
          assists?: number
          body_condition?: string | null
          card_received?: string | null
          competition?: string
          computed_rating?: number
          created_at?: string | null
          goals?: number
          id?: string
          logged_by?: string | null
          logged_by_role?: string | null
          match_date?: string | null
          minutes_played?: number
          opponent?: string | null
          opponent_score?: number
          position?: string
          self_rating?: string | null
          team_score?: number
          user_id?: string
          venue?: string
        }
        Relationships: []
      }
      meeting_requests: {
        Row: {
          coach_user_id: string
          created_at: string | null
          id: string
          reason: string | null
          squad_player_id: string
          status: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string | null
          id?: string
          reason?: string | null
          squad_player_id: string
          status?: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string | null
          id?: string
          reason?: string | null
          squad_player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_requests_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_invites: {
        Row: {
          created_at: string | null
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invite_token?: string
          parent_email: string
          player_user_id: string
          status?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invite_token?: string
          parent_email?: string
          player_user_id?: string
          status?: string
        }
        Relationships: []
      }
      player_details: {
        Row: {
          age_group: string | null
          created_at: string | null
          current_club: string | null
          date_of_birth: string | null
          id: string
          position: string | null
          shirt_number: number | null
          user_id: string
        }
        Insert: {
          age_group?: string | null
          created_at?: string | null
          current_club?: string | null
          date_of_birth?: string | null
          id?: string
          position?: string | null
          shirt_number?: number | null
          user_id: string
        }
        Update: {
          age_group?: string | null
          created_at?: string | null
          current_club?: string | null
          date_of_birth?: string | null
          id?: string
          position?: string | null
          shirt_number?: number | null
          user_id?: string
        }
        Relationships: []
      }
      player_parent_links: {
        Row: {
          created_at: string | null
          id: string
          parent_user_id: string
          player_user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          parent_user_id: string
          player_user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          parent_user_id?: string
          player_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string
          id: string
          invite_code: string | null
          nationality: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          invite_code?: string | null
          nationality?: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          invite_code?: string | null
          nationality?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      recognition_awards: {
        Row: {
          award_type: string
          awarded_for: string | null
          coach_name_snapshot: string | null
          coach_user_id: string
          created_at: string | null
          id: string
          note: string | null
          organization_id: string | null
          squad_player_id: string
        }
        Insert: {
          award_type: string
          awarded_for?: string | null
          coach_name_snapshot?: string | null
          coach_user_id: string
          created_at?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          squad_player_id: string
        }
        Update: {
          award_type?: string
          awarded_for?: string | null
          coach_name_snapshot?: string | null
          coach_user_id?: string
          created_at?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_awards_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          created_at: string | null
          id: string
          minutes_played: number | null
          session_id: string
          squad_player_id: string
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          minutes_played?: number | null
          session_id: string
          squad_player_id: string
          status?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          minutes_played?: number | null
          session_id?: string
          squad_player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coach_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_players: {
        Row: {
          age: number | null
          age_group: string | null
          coach_user_id: string
          created_at: string | null
          id: string
          linked_player_id: string | null
          player_name: string
          position: string | null
          shirt_number: number | null
          status: string
        }
        Insert: {
          age?: number | null
          age_group?: string | null
          coach_user_id: string
          created_at?: string | null
          id?: string
          linked_player_id?: string | null
          player_name: string
          position?: string | null
          shirt_number?: number | null
          status?: string
        }
        Update: {
          age?: number | null
          age_group?: string | null
          coach_user_id?: string
          created_at?: string | null
          id?: string
          linked_player_id?: string | null
          player_name?: string
          position?: string | null
          shirt_number?: number | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_parent_invite: {
        Args: { p_email: string }
        Returns: {
          id: string
          invite_token: string
          parent_email: string
          status: string
        }[]
      }
      delete_my_account: { Args: never; Returns: undefined }
      get_coach_id_by_invite_code: { Args: { p_code: string }; Returns: string }
      get_parent_match_page: {
        Args: {
          p_child_id: string
          p_after_match_date?: string | null
          p_after_created_at?: string | null
          p_after_id?: string | null
          p_limit?: number | null
        }
        Returns: Json
      }
      get_parent_match_summary: {
        Args: { p_child_id: string }
        Returns: {
          total_count: number
          rated_count: number
          average_rating: number | null
          wins: number
          draws: number
          losses: number
        }[]
      }
      get_parent_invite_by_token: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_parent_pending_invites_for_current_user: {
        Args: never
        Returns: {
          created_at: string
          id: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_player_invites_for_current_user: {
        Args: never
        Returns: {
          created_at: string
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_profile_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_club_admin: { Args: never; Returns: boolean }
      remove_coach_from_org: { Args: { p_coach_user_id: string }; Returns: undefined }
      link_parent_to_players_by_email: {
        Args: { p_email: string }
        Returns: number
      }
      log_match_for_player: {
        Args: {
          p_age_group: string
          p_assists: number
          p_body_condition: string
          p_card_received: string
          p_competition: string
          p_computed_rating: number
          p_goals: number
          p_match_date?: string
          p_minutes_played: number
          p_opponent: string
          p_opponent_score: number
          p_position: string
          p_self_rating: string
          p_team_score: number
          p_user_id: string
          p_venue: string
        }
        Returns: undefined
      }
    }
    Enums: {
      user_role: "player" | "coach" | "parent" | "club"
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
      user_role: ["player", "coach", "parent", "club"],
    },
  },
} as const
