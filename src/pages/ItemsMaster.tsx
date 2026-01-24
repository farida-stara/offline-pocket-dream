import { useEffect, useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Search, Plus, Pencil, Trash2, Upload, RotateCcw, Star } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { normalizeArabic } from "@/lib/fuzzy";
import { buildItemSearchTokens, normalizeItemSearchTerm } from "@/lib/itemSearch";

type LastImportCache = {
  name: string;
  type: string;
  lastModified: number;
  dataBase64: string;
};

const LAST_IMPORT_STORAGE_KEY = "items_master:last_import:v1";
const MAX_CACHED_FILE_BYTES = 4_500_000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

interface ItemFormData {
  id?: string;
  item_code: string;
  item_name: string;
  category: string;
  cost_price: number;
  selling_price: number;
  min_stock_level: number;
  notes: string;
}

const defaultFormData: ItemFormData = {
  item_code: "",
  item_name: "",
  category: "",
  cost_price: 0,
  selling_price: 0,
  min_stock_level: 0,
  notes: "",
};

const ItemsMaster = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const FAVORITES_KEY = "items_master:favorites:v1";
  const RECENT_KEY = "items_master:recent:v1";

  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      return new Set(arr);
    } catch {
      return new Set();
    }
  });

  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ItemFormData>(defaultFormData);
  const [isEditing, setIsEditing] = useState(false);

  const [lastImport, setLastImport] = useState<Pick<LastImportCache, "name" | "lastModified"> | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LastImportCache;
      return { name: parsed.name, lastModified: parsed.lastModified };
    } catch {
      return null;
    }
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["items-master", search],
    queryFn: async () => {
      let query = supabase
        .from("items_master")
        .select("*")
        .order("item_name");

      if (search) {
        const tokens = buildItemSearchTokens(search);
        const orParts: string[] = [];
        for (const t of tokens) {
          // note: ilike is case-insensitive and works well for partial matches
          orParts.push(`item_name.ilike.%${t}%`);
          orParts.push(`item_code.ilike.%${t}%`);
        }
        query = query.or(orParts.join(","));
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const existingCodes = useMemo(() => {
    return new Set((items ?? []).map(i => normalizeArabic(i.item_code)));
  }, [items]);

  const existingNames = useMemo(() => {
    return new Set((items ?? []).map(i => normalizeArabic(i.item_name)));
  }, [items]);

  const favoriteItems = useMemo(() => {
    const map = new Map((items ?? []).map((it: any) => [it.id, it]));
    return Array.from(favorites)
      .map((id) => map.get(id))
      .filter(Boolean)
      .slice(0, 8);
  }, [favorites, items]);

  const recentItems = useMemo(() => {
    const map = new Map((items ?? []).map((it: any) => [it.id, it]));
    return (recentIds ?? [])
      .map((id) => map.get(id))
      .filter(Boolean)
      .slice(0, 8);
  }, [recentIds, items]);

  const persistFavorites = (next: Set<string>) => {
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore
    }
  };

  const toggleFavorite = (itemId: string) => {
    const next = new Set(favorites);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    persistFavorites(next);
  };

  const pushRecent = (itemId: string) => {
    const next = [itemId, ...(recentIds ?? []).filter((x) => x !== itemId)].slice(0, 20);
    setRecentIds(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (data: ItemFormData) => {
      if (data.id) {
        const { error } = await supabase
          .from("items_master")
          .update({
            item_code: data.item_code.trim(),
            item_name: data.item_name.trim(),
            category: data.category.trim() || "عام",
            cost_price: data.cost_price,
            selling_price: data.selling_price,
            min_stock_level: data.min_stock_level,
            notes: data.notes.trim() || null,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("items_master")
          .insert({
            item_code: data.item_code.trim(),
            item_name: data.item_name.trim(),
            category: data.category.trim() || "عام",
            cost_price: data.cost_price,
            selling_price: data.selling_price,
            min_stock_level: data.min_stock_level,
            notes: data.notes.trim() || null,
            is_active: true,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? "تم تعديل الصنف بنجاح" : "تم إضافة الصنف بنجاح");
      queryClient.invalidateQueries({ queryKey: ["items-master"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setDialogOpen(false);
      setFormData(defaultFormData);
      setIsEditing(false);
    },
    onError: (error: any) => {
      if (error?.code === "23505") {
        toast.error("كود الصنف موجود مسبقاً");
      } else {
        toast.error("خطأ في الحفظ: " + error.message);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("items_master")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف الصنف بنجاح");
      queryClient.invalidateQueries({ queryKey: ["items-master"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error: any) => {
      toast.error("خطأ في الحذف: " + error.message);
    },
  });

  const openAddDialog = () => {
    setFormData(defaultFormData);
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEditDialog = (item: any) => {
    pushRecent(item.id);
    setFormData({
      id: item.id,
      item_code: item.item_code || "",
      item_name: item.item_name || "",
      category: item.category || "",
      cost_price: item.cost_price || 0,
      selling_price: item.selling_price || 0,
      min_stock_level: item.min_stock_level || 0,
      notes: item.notes || "",
    });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!formData.item_code.trim()) {
      toast.error("الرجاء إدخال كود الصنف");
      return;
    }
    if (!formData.item_name.trim()) {
      toast.error("الرجاء إدخال اسم الصنف");
      return;
    }
    saveMutation.mutate(formData);
  };

  const triggerFilePick = () => fileInputRef.current?.click();

  const cacheLastImport = (file: File, buf: ArrayBuffer) => {
    try {
      if (buf.byteLength > MAX_CACHED_FILE_BYTES) {
        setLastImport(null);
        localStorage.removeItem(LAST_IMPORT_STORAGE_KEY);
        return;
      }

      const payload: LastImportCache = {
        name: file.name,
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified,
        dataBase64: arrayBufferToBase64(buf),
      };

      localStorage.setItem(LAST_IMPORT_STORAGE_KEY, JSON.stringify(payload));
      setLastImport({ name: payload.name, lastModified: payload.lastModified });
    } catch {
      setLastImport(null);
    }
  };

  const importFromArrayBuffer = async (buf: ArrayBuffer) => {
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("لا يوجد ورقة عمل داخل الملف");

    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true });

    const headerRowIndex = rows.findIndex((r: any[]) =>
      (r ?? []).some((c) => {
        const s = String(c ?? "").toLowerCase();
        return s.includes("اسم") || s.includes("كود") || s.includes("name") || s.includes("code");
      })
    );

    if (headerRowIndex === -1) {
      throw new Error("لم أتمكن من العثور على صف العناوين");
    }

    const header = Array.from(rows[headerRowIndex] ?? [], (c) => String(c ?? "").trim().toLowerCase());
    const findCol = (candidates: string[]) =>
      header.findIndex((h) => candidates.some((cand) => h.includes(cand)));

    const colCode = findCol(["كود", "code", "رمز"]);
    const colName = findCol(["اسم", "name", "الصنف", "النوع"]);
    const colCategory = findCol(["الفئة", "category", "التصنيف"]);
    const colCost = findCol(["التكلفة", "cost", "سعر الشراء"]);
    const colSelling = findCol(["البيع", "selling", "سعر البيع"]);
    const colMinStock = findCol(["الحد الأدنى", "min", "minimum"]);

    if (colName === -1) {
      throw new Error("لم يتم العثور على عمود اسم الصنف");
    }

    const dataRows = rows.slice(headerRowIndex + 1);
    const toInsert: any[] = [];
    let skipped = 0;

    for (const r of dataRows) {
      const nameRaw = String(r?.[colName] ?? "").trim();
      if (!nameRaw) continue;

      const codeRaw = colCode !== -1 ? String(r?.[colCode] ?? "").trim() : "";
      const code = codeRaw || `AUTO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      // Skip if name or code already exists
      if (existingNames.has(normalizeArabic(nameRaw)) || existingCodes.has(normalizeArabic(code))) {
        skipped++;
        continue;
      }

      toInsert.push({
        item_code: code,
        item_name: nameRaw,
        category: colCategory !== -1 ? String(r?.[colCategory] ?? "").trim() || "مستورد" : "مستورد",
        cost_price: colCost !== -1 ? Number(r?.[colCost] ?? 0) || 0 : 0,
        selling_price: colSelling !== -1 ? Number(r?.[colSelling] ?? 0) || 0 : 0,
        min_stock_level: colMinStock !== -1 ? Number(r?.[colMinStock] ?? 0) || 0 : 0,
        is_active: true,
      });
    }

    if (toInsert.length === 0) {
      if (skipped > 0) {
        toast.info(`جميع الأصناف موجودة مسبقاً (${skipped} صنف)`);
      } else {
        toast.error("لم يتم العثور على أي أصناف صالحة للاستيراد");
      }
      return;
    }

    const { error } = await supabase.from("items_master").insert(toInsert);
    if (error) throw error;

    queryClient.invalidateQueries({ queryKey: ["items-master"] });
    queryClient.invalidateQueries({ queryKey: ["items"] });
    
    let msg = `تم استيراد ${toInsert.length} صنف بنجاح`;
    if (skipped > 0) msg += ` (تم تخطي ${skipped} مكرر)`;
    toast.success(msg);
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      cacheLastImport(file, buf);
      await importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("فشل الاستيراد: " + (e?.message || "خطأ غير معروف"));
    }
  };

  const handleReimportLastFile = async () => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) {
        toast.info("لا يوجد ملف محفوظ للاستيراد");
        return;
      }

      const cached = JSON.parse(raw) as LastImportCache;
      const buf = base64ToArrayBuffer(cached.dataBase64);
      await importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("تعذر استيراد الملف الأخير: " + (e?.message || "خطأ غير معروف"));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-bold text-slate-900">إدارة الأصناف</h1>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
                e.currentTarget.value = "";
              }}
            />
            <Button variant="outline" onClick={triggerFilePick}>
              <Upload className="h-4 w-4 ml-2" />
              استيراد من Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleReimportLastFile()}
              disabled={!lastImport}
              title={lastImport ? `آخر ملف: ${lastImport.name}` : "لا يوجد ملف سابق"}
            >
              <RotateCcw className="h-4 w-4 ml-2" />
              استيراد الأخير
            </Button>
            <Button onClick={openAddDialog}>
              <Plus className="h-4 w-4 ml-2" />
              إضافة صنف
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">بحث في الأصناف</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث (جزء من الكود/الاسم) — Ctrl+K"
                className="pr-10"
              />
            </div>

            {(favoriteItems.length > 0 || recentItems.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {favoriteItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">مفضلة:</span>
                    {favoriteItems.map((it: any) => (
                      <Button
                        key={it.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setSearch(it.item_code ?? "")}
                        title={it.item_name}
                      >
                        {it.item_code}
                      </Button>
                    ))}
                  </div>
                )}
                {recentItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">آخر استخدام:</span>
                    {recentItems.map((it: any) => (
                      <Button
                        key={it.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSearch(it.item_code ?? "")}
                        title={it.item_name}
                      >
                        {it.item_code}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
            ) : !items?.length ? (
              <div className="p-8 text-center text-muted-foreground">لا توجد أصناف</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الكود</TableHead>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">الفئة</TableHead>
                      <TableHead className="text-left">سعر التكلفة</TableHead>
                      <TableHead className="text-left">سعر البيع</TableHead>
                      <TableHead className="text-center">الحد الأدنى</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                      {items.map((item) => (
                      <TableRow
                        key={item.id}
                        className={!item.is_active ? "opacity-50" : ""}
                        onDoubleClick={() => openEditDialog(item)}
                      >
                        <TableCell className="font-mono">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(item.id);
                              }}
                              title={favorites.has(item.id) ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                            >
                              <Star
                                className={
                                  "h-4 w-4 " +
                                  (favorites.has(item.id)
                                    ? "fill-primary text-primary"
                                    : "text-muted-foreground")
                                }
                              />
                            </Button>
                            <span>{item.item_code}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{item.item_name}</TableCell>
                        <TableCell>{item.category || "-"}</TableCell>
                        <TableCell className="text-left tabular-nums">
                          {Number(item.cost_price || 0).toFixed(3)}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {Number(item.selling_price || 0).toFixed(3)}
                        </TableCell>
                        <TableCell className="text-center">{item.min_stock_level || 0}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("هل أنت متأكد من حذف هذا الصنف؟")) {
                                  deleteMutation.mutate(item.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 text-sm text-muted-foreground text-center">
          إجمالي الأصناف: {items?.length ?? 0}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>{isEditing ? "تعديل صنف" : "إضافة صنف جديد"}</DialogTitle>
              <DialogDescription>
                {isEditing ? "قم بتعديل بيانات الصنف" : "أدخل بيانات الصنف الجديد"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="item_code">كود الصنف *</Label>
                  <Input
                    id="item_code"
                    value={formData.item_code}
                    onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                    placeholder="مثال: ITM001"
                  />
                </div>
                <div>
                  <Label htmlFor="category">الفئة</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="عام"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="item_name">اسم الصنف *</Label>
                <Input
                  id="item_name"
                  value={formData.item_name}
                  onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                  placeholder="اسم الصنف"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cost_price">سعر التكلفة</Label>
                  <Input
                    id="cost_price"
                    type="number"
                    step="0.001"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="selling_price">سعر البيع</Label>
                  <Input
                    id="selling_price"
                    type="number"
                    step="0.001"
                    value={formData.selling_price}
                    onChange={(e) => setFormData({ ...formData, selling_price: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="min_stock_level">الحد الأدنى للمخزون</Label>
                <Input
                  id="min_stock_level"
                  type="number"
                  value={formData.min_stock_level}
                  onChange={(e) => setFormData({ ...formData, min_stock_level: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="notes">ملاحظات</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ملاحظات إضافية"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "جاري الحفظ..." : "حفظ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ItemsMaster;
