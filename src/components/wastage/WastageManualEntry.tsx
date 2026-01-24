import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ItemPickerDialog, type ItemPickerRow } from "@/components/items/ItemPickerDialog";

type WastageLine = {
  id: string;
  item_id: string;
  quantity: number;
  reason_id: string;
  notes: string;
};

type ReasonRow = {
  id: string;
  reason_code: string;
  reason_name: string;
};

type Props = {
  items: ItemPickerRow[] | undefined;
  reasons: ReasonRow[] | undefined;
};

export function WastageManualEntry({ items, reasons }: Props) {
  const queryClient = useQueryClient();

  const [wastageNo, setWastageNo] = useState("");
  const [wastageDate, setWastageDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<WastageLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: 0, reason_id: "", notes: "" },
  ]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemPickerRow>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const openPickerFor = (lineId: string) => {
    setActiveLineId(lineId);
    setPickerOpen(true);
  };

  const updateLine = (id: string, field: keyof WastageLine, value: any) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), item_id: "", quantity: 0, reason_id: "", notes: "" },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines((prev) => prev.filter((l) => l.id !== id));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!wastageNo.trim()) throw new Error("الرجاء إدخال رقم السجل");
      if (!wastageDate) throw new Error("الرجاء إدخال التاريخ");

      const validLines = lines.filter((l) => l.item_id && l.quantity > 0 && l.reason_id);
      if (validLines.length === 0) {
        throw new Error("الرجاء إضافة صنف واحد على الأقل مع الكمية والسبب");
      }

      const { data: header, error: headerError } = await supabase
        .from("wastage_headers")
        .insert({
          wastage_no: wastageNo.trim(),
          wastage_date: wastageDate,
          notes: notes.trim() || null,
        })
        .select()
        .single();

      if (headerError) throw headerError;

      const { error: linesError } = await supabase.from("wastage_lines").insert(
        validLines.map((l, idx) => ({
          wastage_header_id: header.id,
          line_no: idx + 1,
          item_id: l.item_id,
          quantity: l.quantity,
          reason_id: l.reason_id,
          notes: l.notes.trim() || null,
        }))
      );

      if (linesError) throw linesError;
    },
    onSuccess: () => {
      toast.success("تم حفظ سجل التوالف بنجاح");
      queryClient.invalidateQueries({ queryKey: ["wastages-list"] });
      setWastageNo("");
      setWastageDate(new Date().toISOString().split("T")[0]);
      setNotes("");
      setLines([{ id: crypto.randomUUID(), item_id: "", quantity: 0, reason_id: "", notes: "" }]);
    },
    onError: (e: any) => {
      toast.error("خطأ في الحفظ: " + e.message);
    },
  });

  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>إدخال سجل توالف جديد</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Header Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">رقم السجل *</label>
              <Input
                placeholder="مثلاً: W-001"
                value={wastageNo}
                onChange={(e) => setWastageNo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">التاريخ *</label>
              <Input
                type="date"
                value={wastageDate}
                onChange={(e) => setWastageDate(e.target.value)}
              />
            </div>
          </div>

          {/* Lines */}
          <div className="border rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">الأصناف التالفة</h4>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-4 w-4 ml-1" />
                إضافة سطر
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-right p-2">م</th>
                    <th className="text-right p-2">الصنف *</th>
                    <th className="text-right p-2">الكمية *</th>
                    <th className="text-right p-2">سبب التلف *</th>
                    <th className="text-right p-2">ملاحظات</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const item = itemsById.get(line.item_id);
                    return (
                      <tr key={line.id} className="border-b">
                        <td className="p-2">{idx + 1}</td>
                        <td className="p-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-right truncate"
                            onClick={() => openPickerFor(line.id)}
                          >
                            {item ? `${item.item_code} - ${item.item_name}` : "اختر صنف..."}
                          </Button>
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min={0}
                            className="w-24"
                            value={line.quantity || ""}
                            onChange={(e) => updateLine(line.id, "quantity", Number(e.target.value))}
                          />
                        </td>
                        <td className="p-2">
                          <Select
                            value={line.reason_id}
                            onValueChange={(v) => updateLine(line.id, "reason_id", v)}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue placeholder="اختر السبب" />
                            </SelectTrigger>
                            <SelectContent>
                              {(reasons ?? []).map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  {r.reason_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Input
                            className="w-36"
                            placeholder="ملاحظات..."
                            value={line.notes}
                            onChange={(e) => updateLine(line.id, "notes", e.target.value)}
                          />
                        </td>
                        <td className="p-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeLine(line.id)}
                            disabled={lines.length === 1}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium mb-1 block">ملاحظات السجل</label>
            <Textarea
              placeholder="ملاحظات إضافية..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              إجمالي الكميات: <span className="font-semibold">{totalQty}</span>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ السجل"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Item Picker Dialog */}
      <ItemPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        items={items}
        onPick={(itemId) => {
          if (activeLineId) {
            updateLine(activeLineId, "item_id", itemId);
          }
          setPickerOpen(false);
        }}
      />
    </>
  );
}
