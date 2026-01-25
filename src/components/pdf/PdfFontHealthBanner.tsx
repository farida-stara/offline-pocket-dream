import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { checkArabicPdfFontHealth, resetArabicPdfFont, type ArabicPdfFontHealth } from "@/lib/invoicePdf";
import { Loader2, RefreshCcw } from "lucide-react";

type Props = {
  className?: string;
};

export function PdfFontHealthBanner({ className }: Props) {
  const [state, setState] = useState<
    | { status: "idle" | "checking" }
    | { status: "done"; result: ArabicPdfFontHealth }
  >({ status: "idle" });

  const runCheck = async (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetArabicPdfFont();
    setState({ status: "checking" });
    const res = await checkArabicPdfFontHealth();
    setState({ status: "done", result: res });
  };

  useEffect(() => {
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = useMemo(() => {
    if (state.status === "checking") return true;
    if (state.status === "done") return !state.result.ok;
    return false;
  }, [state]);

  if (!show) return null;

  const isChecking = state.status === "checking";
  const result = state.status === "done" ? state.result : null;
  const errorResult =
    result && !result.ok
      ? (result as Extract<ArabicPdfFontHealth, { ok: false }> )
      : null;

  return (
    <Alert className={className}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isChecking ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex-1">
          <AlertTitle>
            {isChecking
              ? "جاري فحص جاهزية PDF…"
              : "مشكلة في خط PDF (العربية)"}
          </AlertTitle>
          <AlertDescription className="mt-1 space-y-2">
            {errorResult ? (
              <>
                <div>
                  <span className="font-medium">السبب:</span> {errorResult.errorMessage}
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">تفاصيل التشخيص</summary>
                  <div className="mt-2 space-y-1">
                    <div className="break-all">
                      <span className="font-medium">مسار الخط:</span> {errorResult.fontUrl}
                    </div>
                    <div>
                      <span className="font-medium">تم تسجيل الخط داخل VFS:</span>{" "}
                      {errorResult.vfsHasFont ? "نعم" : "لا"}
                    </div>
                    <div>
                      <span className="font-medium">عدد أهداف pdfmake المكتشفة:</span> {errorResult.targets}
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">قد يستغرق الفحص ثوانٍ قليلة.</div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runCheck({ reset: true })}
                disabled={isChecking}
              >
                <RefreshCcw className="h-4 w-4 ml-2" />
                إعادة المحاولة
              </Button>
            </div>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
