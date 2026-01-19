import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ReportRow = {
  date: string; // YYYY-MM-DD
  salesRep: string;
  itemCode: string;
  lossAbsTotal: number;
  cases: number;
};

const SAMPLE_ROWS: ReportRow[] = [
  { date: "2026-01-05", salesRep: "أحمد", itemCode: "ITM-1001", lossAbsTotal: 1240, cases: 3 },
  { date: "2026-01-06", salesRep: "سارة", itemCode: "ITM-1003", lossAbsTotal: 640, cases: 2 },
  { date: "2026-01-08", salesRep: "أحمد", itemCode: "ITM-1002", lossAbsTotal: 210, cases: 1 },
  { date: "2026-01-12", salesRep: "خالد", itemCode: "ITM-1001", lossAbsTotal: 980, cases: 4 },
  { date: "2026-01-14", salesRep: "سارة", itemCode: "ITM-1004", lossAbsTotal: 120, cases: 1 },
];

function toNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const Index = () => {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_ROWS.filter((r) => {
      if (fromDate && r.date < fromDate) return false;
      if (toDate && r.date > toDate) return false;
      if (!q) return true;
      return (
        r.salesRep.toLowerCase().includes(q) ||
        r.itemCode.toLowerCase().includes(q) ||
        r.date.includes(q)
      );
    });
  }, [fromDate, toDate, query]);

  const kpis = useMemo(() => {
    const totalLoss = filteredRows.reduce((sum, r) => sum + r.lossAbsTotal, 0);
    const totalCases = filteredRows.reduce((sum, r) => sum + r.cases, 0);
    const avgLossPerCase = totalCases ? totalLoss / totalCases : 0;
    const topRep = filteredRows
      .reduce<Record<string, number>>((acc, r) => {
        acc[r.salesRep] = (acc[r.salesRep] ?? 0) + r.lossAbsTotal;
        return acc;
      }, {})
      ;

    const topRepEntry = Object.entries(topRep).sort((a, b) => b[1] - a[1])[0];

    return {
      totalLoss,
      totalCases,
      avgLossPerCase,
      topRep: topRepEntry ? topRepEntry[0] : "—",
    };
  }, [filteredRows]);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">صفحة التقارير</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            نموذج مبسط لعرض تقارير المراجعة (بيانات تجريبية الآن).
          </p>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-xl">الفلاتر</CardTitle>
            <CardDescription>اختر الفترة والبحث والتاريخ (من/إلى).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">الفترة</label>
                <Select value={period} onValueChange={(v) => setPeriod(v as "weekly" | "monthly")}>
                  <SelectTrigger aria-label="اختيار الفترة">
                    <SelectValue placeholder="اختر" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">أسبوعي</SelectItem>
                    <SelectItem value="monthly">شهري</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">من تاريخ</label>
                <Input aria-label="من تاريخ" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>

              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">إلى تاريخ</label>
                <Input aria-label="إلى تاريخ" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>

              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">بحث</label>
                <Input
                  aria-label="بحث بالموظف أو الصنف"
                  placeholder="مثال: أحمد أو ITM-1001"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="md:col-span-12 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setQuery("");
                  }}
                >
                  مسح الفلاتر
                </Button>

                <Button type="button" variant="outline" onClick={() => window.print()}>
                  طباعة
                </Button>

                <div className="ml-auto text-sm text-muted-foreground">
                  العرض: <span className="font-medium text-foreground">{period === "weekly" ? "أسبوعي" : "شهري"}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>إجمالي الخسارة</CardDescription>
              <CardTitle className="text-2xl">{toNumber(kpis.totalLoss.toFixed(0)).toLocaleString("ar")}</CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>عدد الحالات</CardDescription>
              <CardTitle className="text-2xl">{toNumber(kpis.totalCases.toFixed(0)).toLocaleString("ar")}</CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>متوسط الخسارة لكل حالة</CardDescription>
              <CardTitle className="text-2xl">{toNumber(kpis.avgLossPerCase.toFixed(0)).toLocaleString("ar")}</CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>أعلى موظف خسائر</CardDescription>
              <CardTitle className="text-2xl">{kpis.topRep}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-xl">النتائج</CardTitle>
            <CardDescription>يمكن لاحقًا ربطها ببيانات فعلية من قاعدة البيانات.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead className="text-right">الخسارة (مطلق)</TableHead>
                  <TableHead className="text-right">الحالات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      لا توجد نتائج مطابقة للفلاتر.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((r) => (
                    <TableRow key={`${r.date}-${r.salesRep}-${r.itemCode}`}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.salesRep}</TableCell>
                      <TableCell>{r.itemCode}</TableCell>
                      <TableCell className="text-right">{toNumber(r.lossAbsTotal.toFixed(0)).toLocaleString("ar")}</TableCell>
                      <TableCell className="text-right">{toNumber(r.cases.toFixed(0)).toLocaleString("ar")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
};

export default Index;

