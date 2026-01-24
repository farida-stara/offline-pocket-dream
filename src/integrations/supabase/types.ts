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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_owner: {
        Row: {
          created_at: string
          owner_user_id: string
          singleton_id: boolean
        }
        Insert: {
          created_at?: string
          owner_user_id: string
          singleton_id?: boolean
        }
        Update: {
          created_at?: string
          owner_user_id?: string
          singleton_id?: boolean
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          credit_limit: number | null
          current_balance: number | null
          customer_code: string
          customer_name: string
          email: string | null
          id: string
          is_active: boolean | null
          opening_balance: number | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          credit_limit?: number | null
          current_balance?: number | null
          customer_code: string
          customer_name: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          credit_limit?: number | null
          current_balance?: number | null
          customer_code?: string
          customer_name?: string
          email?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invoice_register: {
        Row: {
          created_at: string | null
          id: string
          invoice_no: string
          invoice_type: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_no: string
          invoice_type: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_no?: string
          invoice_type?: string
          status?: string | null
        }
        Relationships: []
      }
      items_master: {
        Row: {
          category: string
          cost_price: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          item_code: string
          item_name: string
          min_stock_level: number | null
          notes: string | null
          selling_price: number | null
          updated_at: string | null
        }
        Insert: {
          category: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          item_code: string
          item_name: string
          min_stock_level?: number | null
          notes?: string | null
          selling_price?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          cost_price?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          item_code?: string
          item_name?: string
          min_stock_level?: number | null
          notes?: string | null
          selling_price?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      opening_stock: {
        Row: {
          created_at: string | null
          entry_date: string
          id: string
          item_id: string
          notes: string | null
          quantity: number
          total_value: number | null
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          entry_date?: string
          id?: string
          item_id: string
          notes?: string | null
          quantity: number
          total_value?: number | null
          unit_cost: number
        }
        Update: {
          created_at?: string | null
          entry_date?: string
          id?: string
          item_id?: string
          notes?: string | null
          quantity?: number
          total_value?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "opening_stock_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items_master"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_ledger: {
        Row: {
          amount: number
          bank_details: string | null
          created_at: string
          created_by: string | null
          currency: string
          entry_context: string
          id: string
          invoice_id: string | null
          invoice_no: string | null
          invoice_type: string
          notes: string | null
          other_method_name: string | null
          paid_at: string
          party_id: string | null
          party_type: string
          payment_method: string
          reference_no: string | null
          rep_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_details?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_context?: string
          id?: string
          invoice_id?: string | null
          invoice_no?: string | null
          invoice_type: string
          notes?: string | null
          other_method_name?: string | null
          paid_at?: string
          party_id?: string | null
          party_type: string
          payment_method: string
          reference_no?: string | null
          rep_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_details?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_context?: string
          id?: string
          invoice_id?: string | null
          invoice_no?: string | null
          invoice_type?: string
          notes?: string | null
          other_method_name?: string | null
          paid_at?: string
          party_id?: string | null
          party_type?: string
          payment_method?: string
          reference_no?: string | null
          rep_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_ledger_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_headers: {
        Row: {
          created_at: string | null
          id: string
          invoice_date: string
          invoice_no: string
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          supplier_id: string
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_date: string
          invoice_no: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          supplier_id: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_date?: string
          invoice_no?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          supplier_id?: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_headers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_lines: {
        Row: {
          created_at: string | null
          discount_percent: number
          id: string
          item_id: string
          line_no: number
          line_total: number | null
          notes: string | null
          purchase_header_id: string
          quantity_free: number | null
          quantity_paid: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          discount_percent?: number
          id?: string
          item_id: string
          line_no: number
          line_total?: number | null
          notes?: string | null
          purchase_header_id: string
          quantity_free?: number | null
          quantity_paid: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          discount_percent?: number
          id?: string
          item_id?: string
          line_no?: number
          line_total?: number | null
          notes?: string | null
          purchase_header_id?: string
          quantity_free?: number | null
          quantity_paid?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_purchase_header_id_fkey"
            columns: ["purchase_header_id"]
            isOneToOne: false
            referencedRelation: "purchase_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_unmatched_lines: {
        Row: {
          created_at: string
          discount_percent: number
          id: string
          item_id: string | null
          line_no: number
          purchase_header_id: string
          quantity_free: number
          quantity_paid: number
          source_name: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount_percent?: number
          id?: string
          item_id?: string | null
          line_no: number
          purchase_header_id: string
          quantity_free?: number
          quantity_paid?: number
          source_name?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          discount_percent?: number
          id?: string
          item_id?: string | null
          line_no?: number
          purchase_header_id?: string
          quantity_free?: number
          quantity_paid?: number
          source_name?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_unmatched_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_unmatched_lines_purchase_header_id_fkey"
            columns: ["purchase_header_id"]
            isOneToOne: false
            referencedRelation: "purchase_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_headers: {
        Row: {
          created_at: string | null
          customer_id: string | null
          id: string
          invoice_date: string
          invoice_no: string
          notes: string | null
          payment_method: string | null
          payment_status: string | null
          rep_collects: boolean
          sales_rep_id: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          invoice_date: string
          invoice_no: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          rep_collects?: boolean
          sales_rep_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          id?: string
          invoice_date?: string
          invoice_no?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string | null
          rep_collects?: boolean
          sales_rep_id?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_headers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_headers_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_lines: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          line_no: number
          line_total: number | null
          notes: string | null
          quantity: number
          sales_header_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          line_no: number
          line_total?: number | null
          notes?: string | null
          quantity: number
          sales_header_id: string
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          line_no?: number
          line_total?: number | null
          notes?: string | null
          quantity?: number
          sales_header_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_lines_sales_header_id_fkey"
            columns: ["sales_header_id"]
            isOneToOne: false
            referencedRelation: "sales_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_reps: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          phone: string | null
          rep_code: string | null
          rep_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          rep_code?: string | null
          rep_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          rep_code?: string | null
          rep_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          current_balance: number | null
          email: string | null
          id: string
          is_active: boolean | null
          opening_balance: number | null
          phone: string | null
          supplier_code: string
          supplier_name: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          current_balance?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          phone?: string | null
          supplier_code: string
          supplier_name: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          current_balance?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          phone?: string | null
          supplier_code?: string
          supplier_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      wastage_headers: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          updated_at: string
          wastage_date: string
          wastage_no: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          wastage_date: string
          wastage_no: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          wastage_date?: string
          wastage_no?: string
        }
        Relationships: []
      }
      wastage_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_no: number
          notes: string | null
          quantity: number
          reason_id: string | null
          wastage_header_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_no: number
          notes?: string | null
          quantity?: number
          reason_id?: string | null
          wastage_header_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_no?: number
          notes?: string | null
          quantity?: number
          reason_id?: string | null
          wastage_header_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wastage_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastage_lines_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "wastage_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastage_lines_wastage_header_id_fkey"
            columns: ["wastage_header_id"]
            isOneToOne: false
            referencedRelation: "wastage_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      wastage_reasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          reason_code: string
          reason_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          reason_code: string
          reason_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          reason_code?: string
          reason_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      owner_is_unset: { Args: never; Returns: boolean }
      recompute_invoice_payment_status: {
        Args: { _invoice_id: string; _invoice_type: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
