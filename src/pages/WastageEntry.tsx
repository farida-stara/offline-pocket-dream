import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, FileSpreadsheet, Pencil } from "lucide-react";
import { WastageManualEntry } from "@/components/wastage/WastageManualEntry";
import { WastageExcelImport } from "@/components/wastage/WastageExcelImport";

const WastageEntry = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("excel");

  const { data: items } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items_master")
        .select("*")
        .eq("is_active", true)
        .order("item_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: reasons } = useQuery({
    queryKey: ["wastage-reasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wastage_reasons")
        .select("*")
        .eq("is_active", true)
        .order("reason_name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-foreground">سجل التوالف</h1>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="excel" className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              استيراد Excel
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              إدخال يدوي
            </TabsTrigger>
          </TabsList>

          <TabsContent value="excel">
            <WastageExcelImport items={items} reasons={reasons} />
          </TabsContent>

          <TabsContent value="manual">
            <WastageManualEntry items={items} reasons={reasons} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default WastageEntry;
