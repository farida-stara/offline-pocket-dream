-- إنشاء جدول العناصر الرئيسي
CREATE TABLE public.items_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  cost_price DECIMAL(10,3) DEFAULT 0,
  selling_price DECIMAL(10,3) DEFAULT 0,
  min_stock_level INTEGER DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول الموردين
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code TEXT UNIQUE NOT NULL,
  supplier_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  opening_balance DECIMAL(12,3) DEFAULT 0,
  current_balance DECIMAL(12,3) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول العملاء
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  opening_balance DECIMAL(12,3) DEFAULT 0,
  current_balance DECIMAL(12,3) DEFAULT 0,
  credit_limit DECIMAL(12,3) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول الرصيد الافتتاحي للمخزون
CREATE TABLE public.opening_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.items_master(id) ON DELETE CASCADE NOT NULL,
  quantity DECIMAL(10,3) NOT NULL CHECK (quantity >= 0),
  unit_cost DECIMAL(10,3) NOT NULL CHECK (unit_cost >= 0),
  total_value DECIMAL(12,3) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(item_id)
);

-- إنشاء جدول المشتريات - الرؤوس
CREATE TABLE public.purchase_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT UNIQUE NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT NOT NULL,
  invoice_date DATE NOT NULL,
  total_amount DECIMAL(12,3) DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'unpaid',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول المشتريات - الأسطر
CREATE TABLE public.purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_header_id UUID REFERENCES public.purchase_headers(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.items_master(id) ON DELETE RESTRICT NOT NULL,
  quantity_paid DECIMAL(10,3) NOT NULL CHECK (quantity_paid >= 0),
  quantity_free DECIMAL(10,3) DEFAULT 0 CHECK (quantity_free >= 0),
  unit_price DECIMAL(10,3) NOT NULL CHECK (unit_price >= 0),
  line_total DECIMAL(12,3) GENERATED ALWAYS AS (quantity_paid * unit_price) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول المبيعات - الرؤوس
CREATE TABLE public.sales_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  total_amount DECIMAL(12,3) DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT DEFAULT 'unpaid',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول المبيعات - الأسطر
CREATE TABLE public.sales_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_header_id UUID REFERENCES public.sales_headers(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.items_master(id) ON DELETE RESTRICT NOT NULL,
  quantity DECIMAL(10,3) NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,3) NOT NULL CHECK (unit_price >= 0),
  line_total DECIMAL(12,3) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- إنشاء جدول سجل الفواتير المعتمدة
CREATE TABLE public.invoice_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT UNIQUE NOT NULL,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('PURCHASE', 'SALES')),
  status TEXT DEFAULT 'approved',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- تفعيل RLS على جميع الجداول
ALTER TABLE public.items_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_register ENABLE ROW LEVEL SECURITY;

-- سياسات RLS بسيطة للقراءة والكتابة (سيتم تعديلها لاحقاً مع نظام المستخدمين)
CREATE POLICY "Enable read access for all users" ON public.items_master FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.items_master FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.items_master FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.items_master FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.suppliers FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.suppliers FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.suppliers FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.customers FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.customers FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.customers FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.opening_stock FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.opening_stock FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.opening_stock FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.opening_stock FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.purchase_headers FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.purchase_headers FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.purchase_headers FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.purchase_headers FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.purchase_lines FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.purchase_lines FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.purchase_lines FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.purchase_lines FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.sales_headers FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.sales_headers FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.sales_headers FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.sales_headers FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.sales_lines FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.sales_lines FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.sales_lines FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.sales_lines FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON public.invoice_register FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON public.invoice_register FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON public.invoice_register FOR UPDATE USING (true);
CREATE POLICY "Enable delete access for all users" ON public.invoice_register FOR DELETE USING (true);

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق المحفزات على الجداول
CREATE TRIGGER update_items_master_updated_at
  BEFORE UPDATE ON public.items_master
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_purchase_headers_updated_at
  BEFORE UPDATE ON public.purchase_headers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_sales_headers_updated_at
  BEFORE UPDATE ON public.sales_headers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX idx_items_code ON public.items_master(item_code);
CREATE INDEX idx_items_category ON public.items_master(category);
CREATE INDEX idx_suppliers_code ON public.suppliers(supplier_code);
CREATE INDEX idx_customers_code ON public.customers(customer_code);
CREATE INDEX idx_purchase_headers_invoice ON public.purchase_headers(invoice_no);
CREATE INDEX idx_purchase_headers_date ON public.purchase_headers(invoice_date);
CREATE INDEX idx_sales_headers_invoice ON public.sales_headers(invoice_no);
CREATE INDEX idx_sales_headers_date ON public.sales_headers(invoice_date);
CREATE INDEX idx_invoice_register_no ON public.invoice_register(invoice_no);