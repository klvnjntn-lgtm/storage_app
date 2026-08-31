--
-- PostgreSQL database dump
--

\restrict tAFBVENgXlUU3cCe0eIQd1K9hiXaLSF9qIp1ymCbmhI6qCaWBO4SWAxSdZjAPki

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: EventType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."EventType" AS ENUM (
    'IMPORT_REPLACE',
    'IMPORT_INCREMENT',
    'RECEIVE',
    'RETURNS',
    'MOVE',
    'PICK',
    'PACK',
    'SHIP',
    'ADJUSTMENT',
    'SALE'
);


ALTER TYPE public."EventType" OWNER TO postgres;

--
-- Name: ExternalOrderStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ExternalOrderStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'FULFILLED',
    'CANCELLED'
);


ALTER TYPE public."ExternalOrderStatus" OWNER TO postgres;

--
-- Name: FulfillmentMode; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."FulfillmentMode" AS ENUM (
    'PICK_PACK_SHIP',
    'PICK_SHIP'
);


ALTER TYPE public."FulfillmentMode" OWNER TO postgres;

--
-- Name: InvoiceFormat; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvoiceFormat" AS ENUM (
    'RECEIPT',
    'A5',
    'THERMAL_58',
    'A4'
);


ALTER TYPE public."InvoiceFormat" OWNER TO postgres;

--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'DRAFT',
    'ISSUED',
    'VOID'
);


ALTER TYPE public."InvoiceStatus" OWNER TO postgres;

--
-- Name: ModuleKey; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ModuleKey" AS ENUM (
    'INVOICE_POS',
    'WAREHOUSE_OPS',
    'WORKSHOP_RMS'
);


ALTER TYPE public."ModuleKey" OWNER TO postgres;

--
-- Name: PaymentMethod; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentMethod" AS ENUM (
    'CASH',
    'TRANSFER',
    'QRIS',
    'OTHER'
);


ALTER TYPE public."PaymentMethod" OWNER TO postgres;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'UNPAID',
    'PARTIAL',
    'PAID'
);


ALTER TYPE public."PaymentStatus" OWNER TO postgres;

--
-- Name: ReminderStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ReminderStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'DELETED'
);


ALTER TYPE public."ReminderStatus" OWNER TO postgres;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Role" AS ENUM (
    'ADMIN',
    'USER'
);


ALTER TYPE public."Role" OWNER TO postgres;

--
-- Name: SessionType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."SessionType" AS ENUM (
    'RECEIVE',
    'RETURNS',
    'MOVE',
    'ADJUSTMENT',
    'FULFILLMENT'
);


ALTER TYPE public."SessionType" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Brand; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Brand" (
    id text NOT NULL,
    name text NOT NULL,
    "organizationId" text NOT NULL
);


ALTER TABLE public."Brand" OWNER TO postgres;

--
-- Name: Category; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Category" (
    id text NOT NULL,
    name text NOT NULL,
    "organizationId" text NOT NULL
);


ALTER TABLE public."Category" OWNER TO postgres;

--
-- Name: Customer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Customer" (
    id text NOT NULL,
    "orgId" text NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    npwp text,
    "companyName" text
);


ALTER TABLE public."Customer" OWNER TO postgres;

--
-- Name: Event; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Event" (
    id integer NOT NULL,
    "fromLocationId" text,
    "toLocationId" text,
    quantity integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "productId" text NOT NULL,
    type public."EventType" NOT NULL,
    metadata jsonb,
    "sessionId" text,
    "sessionItemId" integer,
    "organizationId" text NOT NULL,
    "userId" text,
    "invoiceId" text
);


ALTER TABLE public."Event" OWNER TO postgres;

--
-- Name: Event_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Event_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Event_id_seq" OWNER TO postgres;

--
-- Name: Event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Event_id_seq" OWNED BY public."Event".id;


--
-- Name: ExternalOrder; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ExternalOrder" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "connectionId" text NOT NULL,
    "externalRef" text NOT NULL,
    "customerName" text,
    status public."ExternalOrderStatus" DEFAULT 'PENDING'::public."ExternalOrderStatus" NOT NULL,
    "sessionId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ExternalOrder" OWNER TO postgres;

--
-- Name: ExternalOrderItem; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ExternalOrderItem" (
    id integer NOT NULL,
    "externalOrderId" text NOT NULL,
    "externalSku" text NOT NULL,
    quantity integer NOT NULL,
    "productId" text
);


ALTER TABLE public."ExternalOrderItem" OWNER TO postgres;

--
-- Name: ExternalOrderItem_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ExternalOrderItem_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ExternalOrderItem_id_seq" OWNER TO postgres;

--
-- Name: ExternalOrderItem_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ExternalOrderItem_id_seq" OWNED BY public."ExternalOrderItem".id;


--
-- Name: ExternalProductMapping; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ExternalProductMapping" (
    id text NOT NULL,
    "connectionId" text NOT NULL,
    "productId" text NOT NULL,
    "externalSku" text NOT NULL
);


ALTER TABLE public."ExternalProductMapping" OWNER TO postgres;

--
-- Name: Installation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Installation" (
    id text DEFAULT 'singleton'::text NOT NULL,
    fingerprint text NOT NULL,
    "machineId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Installation" OWNER TO postgres;

--
-- Name: IntegrationConnection; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."IntegrationConnection" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    provider text NOT NULL,
    "columnMapping" jsonb,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."IntegrationConnection" OWNER TO postgres;

--
-- Name: Invoice; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Invoice" (
    id text NOT NULL,
    "invoiceNumber" text,
    "organizationId" text NOT NULL,
    "locationId" text,
    format public."InvoiceFormat" NOT NULL,
    status public."InvoiceStatus" DEFAULT 'DRAFT'::public."InvoiceStatus" NOT NULL,
    "customerName" text,
    subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    discount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "issuedAt" timestamp(3) without time zone,
    "customerId" text,
    "amountPaid" integer DEFAULT 0 NOT NULL,
    "paymentStatus" public."PaymentStatus" DEFAULT 'UNPAID'::public."PaymentStatus" NOT NULL,
    "dueDate" timestamp(3) without time zone,
    "taxAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    "vehicleId" text
);


ALTER TABLE public."Invoice" OWNER TO postgres;

--
-- Name: InvoiceItem; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvoiceItem" (
    id integer NOT NULL,
    "invoiceId" text NOT NULL,
    "productId" text,
    quantity integer NOT NULL,
    "unitPrice" numeric(12,2) NOT NULL,
    "unitCost" numeric(12,2),
    "lineTotal" numeric(12,2) NOT NULL,
    "taxAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    "locationId" text,
    description text
);


ALTER TABLE public."InvoiceItem" OWNER TO postgres;

--
-- Name: InvoiceItemTax; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvoiceItemTax" (
    id text NOT NULL,
    "invoiceItemId" integer NOT NULL,
    "taxRateId" text,
    name text NOT NULL,
    percentage numeric(5,2) NOT NULL,
    amount numeric(12,2) NOT NULL
);


ALTER TABLE public."InvoiceItemTax" OWNER TO postgres;

--
-- Name: InvoiceItem_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvoiceItem_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvoiceItem_id_seq" OWNER TO postgres;

--
-- Name: InvoiceItem_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvoiceItem_id_seq" OWNED BY public."InvoiceItem".id;


--
-- Name: InvoiceTax; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvoiceTax" (
    id text NOT NULL,
    "invoiceId" text NOT NULL,
    "taxRateId" text,
    name text NOT NULL,
    percentage numeric(5,2) NOT NULL,
    amount numeric(12,2) NOT NULL
);


ALTER TABLE public."InvoiceTax" OWNER TO postgres;

--
-- Name: License; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."License" (
    id text NOT NULL,
    key text NOT NULL,
    "customerName" text NOT NULL,
    "branchName" text NOT NULL,
    domain text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "issuedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "lastCheckIn" timestamp(3) without time zone
);


ALTER TABLE public."License" OWNER TO postgres;

--
-- Name: Location; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Location" (
    id text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "archivedAt" timestamp(3) without time zone,
    address text,
    phone text
);


ALTER TABLE public."Location" OWNER TO postgres;

--
-- Name: Organization; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Organization" (
    id text NOT NULL,
    name text NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    "seatLimit" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "fulfillmentMode" public."FulfillmentMode" DEFAULT 'PICK_PACK_SHIP'::public."FulfillmentMode" NOT NULL,
    "posPricingEnabled" boolean DEFAULT false NOT NULL,
    "bankAccountName" text,
    "bankAccountNumber" text,
    "bankName" text,
    "legalName" text,
    "logoUrl" text,
    npwp text,
    "taxEnabled" boolean DEFAULT false NOT NULL,
    "taxName" text,
    "taxPercentage" numeric(5,2)
);


ALTER TABLE public."Organization" OWNER TO postgres;

--
-- Name: OrganizationModule; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."OrganizationModule" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    module public."ModuleKey" NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "activatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone
);


ALTER TABLE public."OrganizationModule" OWNER TO postgres;

--
-- Name: OrganizationTaxRate; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."OrganizationTaxRate" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    percentage numeric(5,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "archivedAt" timestamp(3) without time zone,
    "isDefault" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."OrganizationTaxRate" OWNER TO postgres;

--
-- Name: Payment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "invoiceId" text NOT NULL,
    amount integer NOT NULL,
    method public."PaymentMethod" DEFAULT 'CASH'::public."PaymentMethod" NOT NULL,
    note text,
    "recordedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Payment" OWNER TO postgres;

--
-- Name: Product; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Product" (
    id text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "categoryId" text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "brandId" text,
    sku text,
    oem text,
    "organizationId" text NOT NULL,
    barcode text,
    "costPrice" numeric(12,2),
    "sellingPrice" numeric(12,2)
);


ALTER TABLE public."Product" OWNER TO postgres;

--
-- Name: Session; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "organizationId" text NOT NULL,
    type public."SessionType" NOT NULL,
    stage public."EventType",
    "invoiceId" text
);


ALTER TABLE public."Session" OWNER TO postgres;

--
-- Name: SessionItem; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SessionItem" (
    id integer NOT NULL,
    "sessionId" text NOT NULL,
    "productId" text NOT NULL,
    quantity integer NOT NULL
);


ALTER TABLE public."SessionItem" OWNER TO postgres;

--
-- Name: SessionItem_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."SessionItem_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SessionItem_id_seq" OWNER TO postgres;

--
-- Name: SessionItem_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."SessionItem_id_seq" OWNED BY public."SessionItem".id;


--
-- Name: SessionNote; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SessionNote" (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    note text NOT NULL,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SessionNote" OWNER TO postgres;

--
-- Name: SessionReopenEvent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SessionReopenEvent" (
    id integer NOT NULL,
    "sessionId" text NOT NULL,
    reason text NOT NULL,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SessionReopenEvent" OWNER TO postgres;

--
-- Name: SessionReopenEvent_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."SessionReopenEvent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SessionReopenEvent_id_seq" OWNER TO postgres;

--
-- Name: SessionReopenEvent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."SessionReopenEvent_id_seq" OWNED BY public."SessionReopenEvent".id;


--
-- Name: Stock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Stock" (
    id integer NOT NULL,
    "productId" text NOT NULL,
    "locationId" text NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    "organizationId" text NOT NULL
);


ALTER TABLE public."Stock" OWNER TO postgres;

--
-- Name: Stock_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Stock_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Stock_id_seq" OWNER TO postgres;

--
-- Name: Stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Stock_id_seq" OWNED BY public."Stock".id;


--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "currentSessionId" text
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: Vehicle; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Vehicle" (
    id text NOT NULL,
    "customerId" text NOT NULL,
    "plateNumber" text NOT NULL,
    "vehicleModel" text NOT NULL,
    vin text,
    odometer integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Vehicle" OWNER TO postgres;

--
-- Name: VehicleReminder; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VehicleReminder" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "vehicleId" text NOT NULL,
    note text NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    status public."ReminderStatus" DEFAULT 'PENDING'::public."ReminderStatus" NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."VehicleReminder" OWNER TO postgres;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: Event id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event" ALTER COLUMN id SET DEFAULT nextval('public."Event_id_seq"'::regclass);


--
-- Name: ExternalOrderItem id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrderItem" ALTER COLUMN id SET DEFAULT nextval('public."ExternalOrderItem_id_seq"'::regclass);


--
-- Name: InvoiceItem id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItem" ALTER COLUMN id SET DEFAULT nextval('public."InvoiceItem_id_seq"'::regclass);


--
-- Name: SessionItem id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionItem" ALTER COLUMN id SET DEFAULT nextval('public."SessionItem_id_seq"'::regclass);


--
-- Name: SessionReopenEvent id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionReopenEvent" ALTER COLUMN id SET DEFAULT nextval('public."SessionReopenEvent_id_seq"'::regclass);


--
-- Name: Stock id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Stock" ALTER COLUMN id SET DEFAULT nextval('public."Stock_id_seq"'::regclass);


--
-- Data for Name: Brand; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Brand" (id, name, "organizationId") FROM stdin;
toyota	Toyota	803dc602-6c99-4985-906b-8d4bafb1a033
\.


--
-- Data for Name: Category; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Category" (id, name, "organizationId") FROM stdin;
bj	BJ	803dc602-6c99-4985-906b-8d4bafb1a033
\.


--
-- Data for Name: Customer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Customer" (id, "orgId", name, phone, address, "createdAt", "updatedAt", npwp, "companyName") FROM stdin;
cmsqkfzds0001uo01byz05v8v	803dc602-6c99-4985-906b-8d4bafb1a033	Adit	081372127181	Bengkong Centre Blok A 14	2026-08-12 20:52:54.112	2026-08-12 20:52:54.112	\N	\N
cmt0id8xg000hq601cjfbxwul	803dc602-6c99-4985-906b-8d4bafb1a033	Kelvin Jonatan	\N	Bengkong Centre Blok A 14	2026-08-19 19:52:29.045	2026-08-19 19:52:29.045	\N	\N
\.


--
-- Data for Name: Event; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Event" (id, "fromLocationId", "toLocationId", quantity, "createdAt", "productId", type, metadata, "sessionId", "sessionItemId", "organizationId", "userId", "invoiceId") FROM stdin;
1	\N	rack_a1	5	2026-08-09 08:34:53.436	f80785b1-9d11-4388-88e4-b65c61b0b83a	IMPORT_INCREMENT	{"sku": "BJ-TY011", "brand": "Toyota", "afterQty": 5, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
2	\N	rack_a2	10	2026-08-09 08:34:53.476	f2aadfd5-84fc-4092-bcd6-a1798827e626	IMPORT_INCREMENT	{"sku": "BJ-TY012", "brand": "Toyota", "afterQty": 10, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
3	\N	rack_a3	14	2026-08-09 08:34:53.509	b6524d27-6618-40a8-8ebb-c36dc6721ddd	IMPORT_INCREMENT	{"sku": "BJ-TY013", "brand": "Toyota", "afterQty": 14, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
4	\N	rack_a4	18	2026-08-09 08:34:53.541	77437287-019c-46c5-81ea-cdb54d2a7d66	IMPORT_INCREMENT	{"sku": "BJ-TY014", "brand": "Toyota", "afterQty": 18, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
5	\N	rack_a5	22	2026-08-09 08:34:53.573	dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	IMPORT_INCREMENT	{"sku": "BJ-TY015", "brand": "Toyota", "afterQty": 22, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
6	\N	rack_a6	26	2026-08-09 08:34:53.607	9289ad06-6dcd-4b7b-976c-c110a91bf5d7	IMPORT_INCREMENT	{"sku": "BJ-TY016", "brand": "Toyota", "afterQty": 26, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
7	\N	rack_a7	30	2026-08-09 08:34:53.636	47f93c10-d202-4b38-8c15-7038c217d905	IMPORT_INCREMENT	{"sku": "BJ-TY017", "brand": "Toyota", "afterQty": 30, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
8	\N	rack_a8	34	2026-08-09 08:34:53.665	bb4fb561-1998-42e1-9bdd-790a7b0cb751	IMPORT_INCREMENT	{"sku": "BJ-TY018", "brand": "Toyota", "afterQty": 34, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
9	\N	rack_a9	38	2026-08-09 08:34:53.694	0ff1d96f-73f1-43a2-865a-eddf0487b994	IMPORT_INCREMENT	{"sku": "BJ-TY019", "brand": "Toyota", "afterQty": 38, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
10	\N	rack_a10	42	2026-08-09 08:34:53.723	51ac41e5-77f2-444d-b04f-2fb88f4ed643	IMPORT_INCREMENT	{"sku": "BJ-TY020", "brand": "Toyota", "afterQty": 42, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
11	\N	rack_a11	46	2026-08-09 08:34:53.752	73ab2803-5078-4209-b334-8e8670c5630e	IMPORT_INCREMENT	{"sku": "BJ-TY021", "brand": "Toyota", "afterQty": 46, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
12	\N	rack_a12	50	2026-08-09 08:34:53.78	03f1c318-9a7f-4122-854e-612b8ece1d7d	IMPORT_INCREMENT	{"sku": "BJ-TY022", "brand": "Toyota", "afterQty": 50, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
13	\N	rack_a13	54	2026-08-09 08:34:53.811	ed32c415-4a1d-4235-a94d-8c8f19e4adf4	IMPORT_INCREMENT	{"sku": "BJ-TY023", "brand": "Toyota", "afterQty": 54, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
14	\N	rack_a14	58	2026-08-09 08:34:53.842	df6d7d48-0a12-42a0-a689-132a751c8a77	IMPORT_INCREMENT	{"sku": "BJ-TY024", "brand": "Toyota", "afterQty": 58, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
15	\N	rack_a15	62	2026-08-09 08:34:53.871	f2b4f786-bd41-488f-8b79-07217222a285	IMPORT_INCREMENT	{"sku": "BJ-TY025", "brand": "Toyota", "afterQty": 62, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
16	\N	rack_a16	66	2026-08-09 08:34:53.902	29bae952-e458-422e-bdbf-dd57a0315b57	IMPORT_INCREMENT	{"sku": "BJ-TY026", "brand": "Toyota", "afterQty": 66, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
17	\N	rack_a17	70	2026-08-09 08:34:53.931	474e07ea-c65c-4d85-8b48-ffeed99cefab	IMPORT_INCREMENT	{"sku": "BJ-TY027", "brand": "Toyota", "afterQty": 70, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
18	\N	rack_a18	74	2026-08-09 08:34:53.959	3982c343-80b5-413d-825c-9e0f24c37558	IMPORT_INCREMENT	{"sku": "BJ-TY028", "brand": "Toyota", "afterQty": 74, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
19	\N	rack_a19	78	2026-08-09 08:34:53.989	723537d5-7499-42c9-99b0-637265b4fcff	IMPORT_INCREMENT	{"sku": "BJ-TY029", "brand": "Toyota", "afterQty": 78, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
20	\N	rack_a20	82	2026-08-09 08:34:54.018	1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	IMPORT_INCREMENT	{"sku": "BJ-TY030", "brand": "Toyota", "afterQty": 82, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
21	\N	rack_a21	86	2026-08-09 08:34:54.047	5c31ef49-fef8-47b1-a006-6a2f728b5959	IMPORT_INCREMENT	{"sku": "BJ-TY031", "brand": "Toyota", "afterQty": 86, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
22	\N	rack_a22	90	2026-08-09 08:34:54.073	05a28014-c1e9-4c5e-8762-5e8dc4505ade	IMPORT_INCREMENT	{"sku": "BJ-TY032", "brand": "Toyota", "afterQty": 90, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
23	\N	rack_a23	94	2026-08-09 08:34:54.1	4f369f76-e6dc-4c0f-b412-046661db8a75	IMPORT_INCREMENT	{"sku": "BJ-TY033", "brand": "Toyota", "afterQty": 94, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
24	\N	rack_a24	98	2026-08-09 08:34:54.126	646ed99b-feff-442b-b19c-d3baa7fdeb7f	IMPORT_INCREMENT	{"sku": "BJ-TY034", "brand": "Toyota", "afterQty": 98, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
25	\N	rack_a25	102	2026-08-09 08:34:54.153	6f8c7632-171f-4b24-b544-3c25e5eeb83f	IMPORT_INCREMENT	{"sku": "BJ-TY035", "brand": "Toyota", "afterQty": 102, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
26	\N	rack_a26	106	2026-08-09 08:34:54.181	a7d7852b-6626-4f68-970f-013d1ca0fb44	IMPORT_INCREMENT	{"sku": "BJ-TY036", "brand": "Toyota", "afterQty": 106, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
27	\N	rack_a27	110	2026-08-09 08:34:54.207	92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	IMPORT_INCREMENT	{"sku": "BJ-TY037", "brand": "Toyota", "afterQty": 110, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
28	\N	rack_a28	114	2026-08-09 08:34:54.235	6f89f946-6012-4c47-a963-3dfca7cc3111	IMPORT_INCREMENT	{"sku": "BJ-TY038", "brand": "Toyota", "afterQty": 114, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
29	\N	rack_a29	118	2026-08-09 08:34:54.261	847fec76-9d32-420b-8829-bc3428892d6a	IMPORT_INCREMENT	{"sku": "BJ-TY039", "brand": "Toyota", "afterQty": 118, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
30	\N	rack_a30	122	2026-08-09 08:34:54.287	991a1535-c776-44b6-b7e9-dc0d152f73c7	IMPORT_INCREMENT	{"sku": "BJ-TY040", "brand": "Toyota", "afterQty": 122, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
31	\N	rack_a31	126	2026-08-09 08:34:54.314	225797d9-b623-4d3f-8973-6e05e589bf18	IMPORT_INCREMENT	{"sku": "BJ-TY041", "brand": "Toyota", "afterQty": 126, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
32	\N	rack_a32	130	2026-08-09 08:34:54.342	27e26b8b-49cc-4c01-abe2-70667adfc37d	IMPORT_INCREMENT	{"sku": "BJ-TY042", "brand": "Toyota", "afterQty": 130, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
33	\N	rack_a33	134	2026-08-09 08:34:54.371	f1e372dc-f83d-4f89-bc67-5eff737f0362	IMPORT_INCREMENT	{"sku": "BJ-TY043", "brand": "Toyota", "afterQty": 134, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
34	\N	rack_a34	138	2026-08-09 08:34:54.409	1f9776ab-29d6-4b5c-94f9-b54a0a577736	IMPORT_INCREMENT	{"sku": "BJ-TY044", "brand": "Toyota", "afterQty": 138, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
35	\N	rack_a35	142	2026-08-09 08:34:54.435	f1329b27-ef69-410e-bc28-cbcd43cf5a47	IMPORT_INCREMENT	{"sku": "BJ-TY045", "brand": "Toyota", "afterQty": 142, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
36	\N	rack_a36	146	2026-08-09 08:34:54.463	7503ee98-8ab7-44f1-8afc-254f29e637aa	IMPORT_INCREMENT	{"sku": "BJ-TY046", "brand": "Toyota", "afterQty": 146, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
37	\N	rack_a37	150	2026-08-09 08:34:54.492	a61b654f-a6ff-4353-8c3a-5f08765bf64e	IMPORT_INCREMENT	{"sku": "BJ-TY047", "brand": "Toyota", "afterQty": 150, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
38	\N	rack_a38	154	2026-08-09 08:34:54.522	f4050299-3d13-414f-9fe3-ebf9d82b40ad	IMPORT_INCREMENT	{"sku": "BJ-TY048", "brand": "Toyota", "afterQty": 154, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
39	\N	rack_a39	158	2026-08-09 08:34:54.553	32f34b55-a471-4fe8-a88d-e569c08d8246	IMPORT_INCREMENT	{"sku": "BJ-TY049", "brand": "Toyota", "afterQty": 158, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
40	\N	rack_a40	162	2026-08-09 08:34:54.582	2a3a2b1c-855d-4c65-a133-624a510f4c30	IMPORT_INCREMENT	{"sku": "BJ-TY050", "brand": "Toyota", "afterQty": 162, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
41	\N	rack_a41	166	2026-08-09 08:34:54.611	02058b49-1710-4d98-b4ce-22448191dfdf	IMPORT_INCREMENT	{"sku": "BJ-TY051", "brand": "Toyota", "afterQty": 166, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
42	\N	rack_a42	170	2026-08-09 08:34:54.639	5e2fb9c7-9757-4f94-b720-0424944e347a	IMPORT_INCREMENT	{"sku": "BJ-TY052", "brand": "Toyota", "afterQty": 170, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
43	\N	rack_a43	174	2026-08-09 08:34:54.666	7cae8090-8e69-41ce-ae47-83c1cce57e7b	IMPORT_INCREMENT	{"sku": "BJ-TY053", "brand": "Toyota", "afterQty": 174, "category": "BJ", "beforeQty": 0}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
67	\N	rack_a1	0	2026-08-11 17:08:29.702	f80785b1-9d11-4388-88e4-b65c61b0b83a	IMPORT_REPLACE	{"sku": "BJ-TY011", "brand": "Toyota", "afterQty": 5, "category": "BJ", "beforeQty": 5}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
68	\N	rack_a2	0	2026-08-11 17:08:29.721	f2aadfd5-84fc-4092-bcd6-a1798827e626	IMPORT_REPLACE	{"sku": "BJ-TY012", "brand": "Toyota", "afterQty": 10, "category": "BJ", "beforeQty": 10}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
69	\N	rack_a3	0	2026-08-11 17:08:29.736	b6524d27-6618-40a8-8ebb-c36dc6721ddd	IMPORT_REPLACE	{"sku": "BJ-TY013", "brand": "Toyota", "afterQty": 14, "category": "BJ", "beforeQty": 14}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
70	\N	rack_a4	0	2026-08-11 17:08:29.75	77437287-019c-46c5-81ea-cdb54d2a7d66	IMPORT_REPLACE	{"sku": "BJ-TY014", "brand": "Toyota", "afterQty": 18, "category": "BJ", "beforeQty": 18}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
71	\N	rack_a5	0	2026-08-11 17:08:29.764	dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	IMPORT_REPLACE	{"sku": "BJ-TY015", "brand": "Toyota", "afterQty": 22, "category": "BJ", "beforeQty": 22}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
72	\N	rack_a6	0	2026-08-11 17:08:29.778	9289ad06-6dcd-4b7b-976c-c110a91bf5d7	IMPORT_REPLACE	{"sku": "BJ-TY016", "brand": "Toyota", "afterQty": 26, "category": "BJ", "beforeQty": 26}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
73	\N	rack_a7	0	2026-08-11 17:08:29.79	47f93c10-d202-4b38-8c15-7038c217d905	IMPORT_REPLACE	{"sku": "BJ-TY017", "brand": "Toyota", "afterQty": 30, "category": "BJ", "beforeQty": 30}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
74	\N	rack_a8	0	2026-08-11 17:08:29.803	bb4fb561-1998-42e1-9bdd-790a7b0cb751	IMPORT_REPLACE	{"sku": "BJ-TY018", "brand": "Toyota", "afterQty": 34, "category": "BJ", "beforeQty": 34}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
75	\N	rack_a9	0	2026-08-11 17:08:29.817	0ff1d96f-73f1-43a2-865a-eddf0487b994	IMPORT_REPLACE	{"sku": "BJ-TY019", "brand": "Toyota", "afterQty": 38, "category": "BJ", "beforeQty": 38}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
76	\N	rack_a10	0	2026-08-11 17:08:29.832	51ac41e5-77f2-444d-b04f-2fb88f4ed643	IMPORT_REPLACE	{"sku": "BJ-TY020", "brand": "Toyota", "afterQty": 42, "category": "BJ", "beforeQty": 42}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
77	\N	rack_a11	0	2026-08-11 17:08:29.845	73ab2803-5078-4209-b334-8e8670c5630e	IMPORT_REPLACE	{"sku": "BJ-TY021", "brand": "Toyota", "afterQty": 46, "category": "BJ", "beforeQty": 46}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
78	\N	rack_a12	0	2026-08-11 17:08:29.861	03f1c318-9a7f-4122-854e-612b8ece1d7d	IMPORT_REPLACE	{"sku": "BJ-TY022", "brand": "Toyota", "afterQty": 50, "category": "BJ", "beforeQty": 50}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
79	\N	rack_a13	0	2026-08-11 17:08:29.875	ed32c415-4a1d-4235-a94d-8c8f19e4adf4	IMPORT_REPLACE	{"sku": "BJ-TY023", "brand": "Toyota", "afterQty": 54, "category": "BJ", "beforeQty": 54}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
80	\N	rack_a14	0	2026-08-11 17:08:29.887	df6d7d48-0a12-42a0-a689-132a751c8a77	IMPORT_REPLACE	{"sku": "BJ-TY024", "brand": "Toyota", "afterQty": 58, "category": "BJ", "beforeQty": 58}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
81	\N	rack_a15	0	2026-08-11 17:08:29.901	f2b4f786-bd41-488f-8b79-07217222a285	IMPORT_REPLACE	{"sku": "BJ-TY025", "brand": "Toyota", "afterQty": 62, "category": "BJ", "beforeQty": 62}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
82	\N	rack_a16	0	2026-08-11 17:08:29.915	29bae952-e458-422e-bdbf-dd57a0315b57	IMPORT_REPLACE	{"sku": "BJ-TY026", "brand": "Toyota", "afterQty": 66, "category": "BJ", "beforeQty": 66}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
83	\N	rack_a17	0	2026-08-11 17:08:29.928	474e07ea-c65c-4d85-8b48-ffeed99cefab	IMPORT_REPLACE	{"sku": "BJ-TY027", "brand": "Toyota", "afterQty": 70, "category": "BJ", "beforeQty": 70}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
84	\N	rack_a18	0	2026-08-11 17:08:29.939	3982c343-80b5-413d-825c-9e0f24c37558	IMPORT_REPLACE	{"sku": "BJ-TY028", "brand": "Toyota", "afterQty": 74, "category": "BJ", "beforeQty": 74}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
85	\N	rack_a19	0	2026-08-11 17:08:29.953	723537d5-7499-42c9-99b0-637265b4fcff	IMPORT_REPLACE	{"sku": "BJ-TY029", "brand": "Toyota", "afterQty": 78, "category": "BJ", "beforeQty": 78}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
86	\N	rack_a20	0	2026-08-11 17:08:29.969	1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	IMPORT_REPLACE	{"sku": "BJ-TY030", "brand": "Toyota", "afterQty": 82, "category": "BJ", "beforeQty": 82}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
87	\N	rack_a21	0	2026-08-11 17:08:29.981	5c31ef49-fef8-47b1-a006-6a2f728b5959	IMPORT_REPLACE	{"sku": "BJ-TY031", "brand": "Toyota", "afterQty": 86, "category": "BJ", "beforeQty": 86}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
88	\N	rack_a22	0	2026-08-11 17:08:29.995	05a28014-c1e9-4c5e-8762-5e8dc4505ade	IMPORT_REPLACE	{"sku": "BJ-TY032", "brand": "Toyota", "afterQty": 90, "category": "BJ", "beforeQty": 90}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
89	\N	rack_a23	0	2026-08-11 17:08:30.008	4f369f76-e6dc-4c0f-b412-046661db8a75	IMPORT_REPLACE	{"sku": "BJ-TY033", "brand": "Toyota", "afterQty": 94, "category": "BJ", "beforeQty": 94}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
90	\N	rack_a24	0	2026-08-11 17:08:30.027	646ed99b-feff-442b-b19c-d3baa7fdeb7f	IMPORT_REPLACE	{"sku": "BJ-TY034", "brand": "Toyota", "afterQty": 98, "category": "BJ", "beforeQty": 98}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
91	\N	rack_a25	0	2026-08-11 17:08:30.041	6f8c7632-171f-4b24-b544-3c25e5eeb83f	IMPORT_REPLACE	{"sku": "BJ-TY035", "brand": "Toyota", "afterQty": 102, "category": "BJ", "beforeQty": 102}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
92	\N	rack_a26	0	2026-08-11 17:08:30.053	a7d7852b-6626-4f68-970f-013d1ca0fb44	IMPORT_REPLACE	{"sku": "BJ-TY036", "brand": "Toyota", "afterQty": 106, "category": "BJ", "beforeQty": 106}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
93	\N	rack_a27	0	2026-08-11 17:08:30.067	92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	IMPORT_REPLACE	{"sku": "BJ-TY037", "brand": "Toyota", "afterQty": 110, "category": "BJ", "beforeQty": 110}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
94	\N	rack_a28	0	2026-08-11 17:08:30.082	6f89f946-6012-4c47-a963-3dfca7cc3111	IMPORT_REPLACE	{"sku": "BJ-TY038", "brand": "Toyota", "afterQty": 114, "category": "BJ", "beforeQty": 114}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
95	\N	rack_a29	0	2026-08-11 17:08:30.095	847fec76-9d32-420b-8829-bc3428892d6a	IMPORT_REPLACE	{"sku": "BJ-TY039", "brand": "Toyota", "afterQty": 118, "category": "BJ", "beforeQty": 118}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
96	\N	rack_a30	0	2026-08-11 17:08:30.109	991a1535-c776-44b6-b7e9-dc0d152f73c7	IMPORT_REPLACE	{"sku": "BJ-TY040", "brand": "Toyota", "afterQty": 122, "category": "BJ", "beforeQty": 122}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
97	\N	rack_a31	0	2026-08-11 17:08:30.124	225797d9-b623-4d3f-8973-6e05e589bf18	IMPORT_REPLACE	{"sku": "BJ-TY041", "brand": "Toyota", "afterQty": 126, "category": "BJ", "beforeQty": 126}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
98	\N	rack_a32	0	2026-08-11 17:08:30.139	27e26b8b-49cc-4c01-abe2-70667adfc37d	IMPORT_REPLACE	{"sku": "BJ-TY042", "brand": "Toyota", "afterQty": 130, "category": "BJ", "beforeQty": 130}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
99	\N	rack_a33	0	2026-08-11 17:08:30.151	f1e372dc-f83d-4f89-bc67-5eff737f0362	IMPORT_REPLACE	{"sku": "BJ-TY043", "brand": "Toyota", "afterQty": 134, "category": "BJ", "beforeQty": 134}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
100	\N	rack_a34	0	2026-08-11 17:08:30.164	1f9776ab-29d6-4b5c-94f9-b54a0a577736	IMPORT_REPLACE	{"sku": "BJ-TY044", "brand": "Toyota", "afterQty": 138, "category": "BJ", "beforeQty": 138}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
101	\N	rack_a35	0	2026-08-11 17:08:30.177	f1329b27-ef69-410e-bc28-cbcd43cf5a47	IMPORT_REPLACE	{"sku": "BJ-TY045", "brand": "Toyota", "afterQty": 142, "category": "BJ", "beforeQty": 142}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
102	\N	rack_a36	0	2026-08-11 17:08:30.192	7503ee98-8ab7-44f1-8afc-254f29e637aa	IMPORT_REPLACE	{"sku": "BJ-TY046", "brand": "Toyota", "afterQty": 146, "category": "BJ", "beforeQty": 146}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
103	\N	rack_a37	0	2026-08-11 17:08:30.206	a61b654f-a6ff-4353-8c3a-5f08765bf64e	IMPORT_REPLACE	{"sku": "BJ-TY047", "brand": "Toyota", "afterQty": 150, "category": "BJ", "beforeQty": 150}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
104	\N	rack_a38	0	2026-08-11 17:08:30.219	f4050299-3d13-414f-9fe3-ebf9d82b40ad	IMPORT_REPLACE	{"sku": "BJ-TY048", "brand": "Toyota", "afterQty": 154, "category": "BJ", "beforeQty": 154}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
105	\N	rack_a39	0	2026-08-11 17:08:30.232	32f34b55-a471-4fe8-a88d-e569c08d8246	IMPORT_REPLACE	{"sku": "BJ-TY049", "brand": "Toyota", "afterQty": 158, "category": "BJ", "beforeQty": 158}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
106	\N	rack_a40	0	2026-08-11 17:08:30.243	2a3a2b1c-855d-4c65-a133-624a510f4c30	IMPORT_REPLACE	{"sku": "BJ-TY050", "brand": "Toyota", "afterQty": 162, "category": "BJ", "beforeQty": 162}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
107	\N	rack_a41	0	2026-08-11 17:08:30.254	02058b49-1710-4d98-b4ce-22448191dfdf	IMPORT_REPLACE	{"sku": "BJ-TY051", "brand": "Toyota", "afterQty": 166, "category": "BJ", "beforeQty": 166}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
108	\N	rack_a42	0	2026-08-11 17:08:30.268	5e2fb9c7-9757-4f94-b720-0424944e347a	IMPORT_REPLACE	{"sku": "BJ-TY052", "brand": "Toyota", "afterQty": 170, "category": "BJ", "beforeQty": 170}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
109	\N	rack_a43	0	2026-08-11 17:08:30.282	7cae8090-8e69-41ce-ae47-83c1cce57e7b	IMPORT_REPLACE	{"sku": "BJ-TY053", "brand": "Toyota", "afterQty": 174, "category": "BJ", "beforeQty": 174}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
110	\N	rack_a1	0	2026-08-11 19:05:51.797	f80785b1-9d11-4388-88e4-b65c61b0b83a	IMPORT_REPLACE	{"sku": "BJ-TY011", "brand": "Toyota", "afterQty": 5, "category": "BJ", "beforeQty": 5}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
111	\N	rack_a2	0	2026-08-11 19:05:51.815	f2aadfd5-84fc-4092-bcd6-a1798827e626	IMPORT_REPLACE	{"sku": "BJ-TY012", "brand": "Toyota", "afterQty": 10, "category": "BJ", "beforeQty": 10}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
112	\N	rack_a3	0	2026-08-11 19:05:51.83	b6524d27-6618-40a8-8ebb-c36dc6721ddd	IMPORT_REPLACE	{"sku": "BJ-TY013", "brand": "Toyota", "afterQty": 14, "category": "BJ", "beforeQty": 14}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
113	\N	rack_a4	0	2026-08-11 19:05:51.844	77437287-019c-46c5-81ea-cdb54d2a7d66	IMPORT_REPLACE	{"sku": "BJ-TY014", "brand": "Toyota", "afterQty": 18, "category": "BJ", "beforeQty": 18}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
114	\N	rack_a5	0	2026-08-11 19:05:51.856	dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	IMPORT_REPLACE	{"sku": "BJ-TY015", "brand": "Toyota", "afterQty": 22, "category": "BJ", "beforeQty": 22}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
115	\N	rack_a6	0	2026-08-11 19:05:51.871	9289ad06-6dcd-4b7b-976c-c110a91bf5d7	IMPORT_REPLACE	{"sku": "BJ-TY016", "brand": "Toyota", "afterQty": 26, "category": "BJ", "beforeQty": 26}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
116	\N	rack_a7	0	2026-08-11 19:05:51.886	47f93c10-d202-4b38-8c15-7038c217d905	IMPORT_REPLACE	{"sku": "BJ-TY017", "brand": "Toyota", "afterQty": 30, "category": "BJ", "beforeQty": 30}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
117	\N	rack_a8	0	2026-08-11 19:05:51.898	bb4fb561-1998-42e1-9bdd-790a7b0cb751	IMPORT_REPLACE	{"sku": "BJ-TY018", "brand": "Toyota", "afterQty": 34, "category": "BJ", "beforeQty": 34}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
118	\N	rack_a9	0	2026-08-11 19:05:51.91	0ff1d96f-73f1-43a2-865a-eddf0487b994	IMPORT_REPLACE	{"sku": "BJ-TY019", "brand": "Toyota", "afterQty": 38, "category": "BJ", "beforeQty": 38}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
119	\N	rack_a10	0	2026-08-11 19:05:51.923	51ac41e5-77f2-444d-b04f-2fb88f4ed643	IMPORT_REPLACE	{"sku": "BJ-TY020", "brand": "Toyota", "afterQty": 42, "category": "BJ", "beforeQty": 42}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
120	\N	rack_a11	0	2026-08-11 19:05:51.935	73ab2803-5078-4209-b334-8e8670c5630e	IMPORT_REPLACE	{"sku": "BJ-TY021", "brand": "Toyota", "afterQty": 46, "category": "BJ", "beforeQty": 46}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
121	\N	rack_a12	0	2026-08-11 19:05:51.947	03f1c318-9a7f-4122-854e-612b8ece1d7d	IMPORT_REPLACE	{"sku": "BJ-TY022", "brand": "Toyota", "afterQty": 50, "category": "BJ", "beforeQty": 50}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
122	\N	rack_a13	0	2026-08-11 19:05:51.959	ed32c415-4a1d-4235-a94d-8c8f19e4adf4	IMPORT_REPLACE	{"sku": "BJ-TY023", "brand": "Toyota", "afterQty": 54, "category": "BJ", "beforeQty": 54}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
123	\N	rack_a14	0	2026-08-11 19:05:51.978	df6d7d48-0a12-42a0-a689-132a751c8a77	IMPORT_REPLACE	{"sku": "BJ-TY024", "brand": "Toyota", "afterQty": 58, "category": "BJ", "beforeQty": 58}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
124	\N	rack_a15	0	2026-08-11 19:05:51.991	f2b4f786-bd41-488f-8b79-07217222a285	IMPORT_REPLACE	{"sku": "BJ-TY025", "brand": "Toyota", "afterQty": 62, "category": "BJ", "beforeQty": 62}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
125	\N	rack_a16	0	2026-08-11 19:05:52.003	29bae952-e458-422e-bdbf-dd57a0315b57	IMPORT_REPLACE	{"sku": "BJ-TY026", "brand": "Toyota", "afterQty": 66, "category": "BJ", "beforeQty": 66}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
126	\N	rack_a17	0	2026-08-11 19:05:52.016	474e07ea-c65c-4d85-8b48-ffeed99cefab	IMPORT_REPLACE	{"sku": "BJ-TY027", "brand": "Toyota", "afterQty": 70, "category": "BJ", "beforeQty": 70}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
127	\N	rack_a18	0	2026-08-11 19:05:52.031	3982c343-80b5-413d-825c-9e0f24c37558	IMPORT_REPLACE	{"sku": "BJ-TY028", "brand": "Toyota", "afterQty": 74, "category": "BJ", "beforeQty": 74}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
128	\N	rack_a19	0	2026-08-11 19:05:52.043	723537d5-7499-42c9-99b0-637265b4fcff	IMPORT_REPLACE	{"sku": "BJ-TY029", "brand": "Toyota", "afterQty": 78, "category": "BJ", "beforeQty": 78}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
129	\N	rack_a20	0	2026-08-11 19:05:52.057	1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	IMPORT_REPLACE	{"sku": "BJ-TY030", "brand": "Toyota", "afterQty": 82, "category": "BJ", "beforeQty": 82}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
130	\N	rack_a21	0	2026-08-11 19:05:52.077	5c31ef49-fef8-47b1-a006-6a2f728b5959	IMPORT_REPLACE	{"sku": "BJ-TY031", "brand": "Toyota", "afterQty": 86, "category": "BJ", "beforeQty": 86}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
131	\N	rack_a22	0	2026-08-11 19:05:52.095	05a28014-c1e9-4c5e-8762-5e8dc4505ade	IMPORT_REPLACE	{"sku": "BJ-TY032", "brand": "Toyota", "afterQty": 90, "category": "BJ", "beforeQty": 90}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
132	\N	rack_a23	0	2026-08-11 19:05:52.115	4f369f76-e6dc-4c0f-b412-046661db8a75	IMPORT_REPLACE	{"sku": "BJ-TY033", "brand": "Toyota", "afterQty": 94, "category": "BJ", "beforeQty": 94}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
133	\N	rack_a24	0	2026-08-11 19:05:52.13	646ed99b-feff-442b-b19c-d3baa7fdeb7f	IMPORT_REPLACE	{"sku": "BJ-TY034", "brand": "Toyota", "afterQty": 98, "category": "BJ", "beforeQty": 98}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
134	\N	rack_a25	0	2026-08-11 19:05:52.144	6f8c7632-171f-4b24-b544-3c25e5eeb83f	IMPORT_REPLACE	{"sku": "BJ-TY035", "brand": "Toyota", "afterQty": 102, "category": "BJ", "beforeQty": 102}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
135	\N	rack_a26	0	2026-08-11 19:05:52.161	a7d7852b-6626-4f68-970f-013d1ca0fb44	IMPORT_REPLACE	{"sku": "BJ-TY036", "brand": "Toyota", "afterQty": 106, "category": "BJ", "beforeQty": 106}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
136	\N	rack_a27	0	2026-08-11 19:05:52.175	92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	IMPORT_REPLACE	{"sku": "BJ-TY037", "brand": "Toyota", "afterQty": 110, "category": "BJ", "beforeQty": 110}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
137	\N	rack_a28	0	2026-08-11 19:05:52.189	6f89f946-6012-4c47-a963-3dfca7cc3111	IMPORT_REPLACE	{"sku": "BJ-TY038", "brand": "Toyota", "afterQty": 114, "category": "BJ", "beforeQty": 114}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
138	\N	rack_a29	0	2026-08-11 19:05:52.203	847fec76-9d32-420b-8829-bc3428892d6a	IMPORT_REPLACE	{"sku": "BJ-TY039", "brand": "Toyota", "afterQty": 118, "category": "BJ", "beforeQty": 118}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
139	\N	rack_a30	0	2026-08-11 19:05:52.216	991a1535-c776-44b6-b7e9-dc0d152f73c7	IMPORT_REPLACE	{"sku": "BJ-TY040", "brand": "Toyota", "afterQty": 122, "category": "BJ", "beforeQty": 122}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
140	\N	rack_a31	0	2026-08-11 19:05:52.229	225797d9-b623-4d3f-8973-6e05e589bf18	IMPORT_REPLACE	{"sku": "BJ-TY041", "brand": "Toyota", "afterQty": 126, "category": "BJ", "beforeQty": 126}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
141	\N	rack_a32	0	2026-08-11 19:05:52.241	27e26b8b-49cc-4c01-abe2-70667adfc37d	IMPORT_REPLACE	{"sku": "BJ-TY042", "brand": "Toyota", "afterQty": 130, "category": "BJ", "beforeQty": 130}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
142	\N	rack_a33	0	2026-08-11 19:05:52.251	f1e372dc-f83d-4f89-bc67-5eff737f0362	IMPORT_REPLACE	{"sku": "BJ-TY043", "brand": "Toyota", "afterQty": 134, "category": "BJ", "beforeQty": 134}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
143	\N	rack_a34	0	2026-08-11 19:05:52.262	1f9776ab-29d6-4b5c-94f9-b54a0a577736	IMPORT_REPLACE	{"sku": "BJ-TY044", "brand": "Toyota", "afterQty": 138, "category": "BJ", "beforeQty": 138}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
144	\N	rack_a35	0	2026-08-11 19:05:52.275	f1329b27-ef69-410e-bc28-cbcd43cf5a47	IMPORT_REPLACE	{"sku": "BJ-TY045", "brand": "Toyota", "afterQty": 142, "category": "BJ", "beforeQty": 142}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
145	\N	rack_a36	0	2026-08-11 19:05:52.287	7503ee98-8ab7-44f1-8afc-254f29e637aa	IMPORT_REPLACE	{"sku": "BJ-TY046", "brand": "Toyota", "afterQty": 146, "category": "BJ", "beforeQty": 146}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
146	\N	rack_a37	0	2026-08-11 19:05:52.298	a61b654f-a6ff-4353-8c3a-5f08765bf64e	IMPORT_REPLACE	{"sku": "BJ-TY047", "brand": "Toyota", "afterQty": 150, "category": "BJ", "beforeQty": 150}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
147	\N	rack_a38	0	2026-08-11 19:05:52.312	f4050299-3d13-414f-9fe3-ebf9d82b40ad	IMPORT_REPLACE	{"sku": "BJ-TY048", "brand": "Toyota", "afterQty": 154, "category": "BJ", "beforeQty": 154}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
148	\N	rack_a39	0	2026-08-11 19:05:52.326	32f34b55-a471-4fe8-a88d-e569c08d8246	IMPORT_REPLACE	{"sku": "BJ-TY049", "brand": "Toyota", "afterQty": 158, "category": "BJ", "beforeQty": 158}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
149	\N	rack_a40	0	2026-08-11 19:05:52.337	2a3a2b1c-855d-4c65-a133-624a510f4c30	IMPORT_REPLACE	{"sku": "BJ-TY050", "brand": "Toyota", "afterQty": 162, "category": "BJ", "beforeQty": 162}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
150	\N	rack_a41	0	2026-08-11 19:05:52.349	02058b49-1710-4d98-b4ce-22448191dfdf	IMPORT_REPLACE	{"sku": "BJ-TY051", "brand": "Toyota", "afterQty": 166, "category": "BJ", "beforeQty": 166}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
151	\N	rack_a42	0	2026-08-11 19:05:52.363	5e2fb9c7-9757-4f94-b720-0424944e347a	IMPORT_REPLACE	{"sku": "BJ-TY052", "brand": "Toyota", "afterQty": 170, "category": "BJ", "beforeQty": 170}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
152	\N	rack_a43	0	2026-08-11 19:05:52.377	7cae8090-8e69-41ce-ae47-83c1cce57e7b	IMPORT_REPLACE	{"sku": "BJ-TY053", "brand": "Toyota", "afterQty": 174, "category": "BJ", "beforeQty": 174}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
153	\N	rack_a1	0	2026-08-11 20:48:29.376	f80785b1-9d11-4388-88e4-b65c61b0b83a	IMPORT_REPLACE	{"sku": "BJ-TY011", "brand": "Toyota", "afterQty": 5, "category": "BJ", "beforeQty": 5}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
154	\N	rack_a2	0	2026-08-11 20:48:29.397	f2aadfd5-84fc-4092-bcd6-a1798827e626	IMPORT_REPLACE	{"sku": "BJ-TY012", "brand": "Toyota", "afterQty": 10, "category": "BJ", "beforeQty": 10}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
155	\N	rack_a3	0	2026-08-11 20:48:29.412	b6524d27-6618-40a8-8ebb-c36dc6721ddd	IMPORT_REPLACE	{"sku": "BJ-TY013", "brand": "Toyota", "afterQty": 14, "category": "BJ", "beforeQty": 14}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
156	\N	rack_a4	0	2026-08-11 20:48:29.433	77437287-019c-46c5-81ea-cdb54d2a7d66	IMPORT_REPLACE	{"sku": "BJ-TY014", "brand": "Toyota", "afterQty": 18, "category": "BJ", "beforeQty": 18}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
157	\N	rack_a5	0	2026-08-11 20:48:29.449	dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	IMPORT_REPLACE	{"sku": "BJ-TY015", "brand": "Toyota", "afterQty": 22, "category": "BJ", "beforeQty": 22}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
158	\N	rack_a6	0	2026-08-11 20:48:29.468	9289ad06-6dcd-4b7b-976c-c110a91bf5d7	IMPORT_REPLACE	{"sku": "BJ-TY016", "brand": "Toyota", "afterQty": 26, "category": "BJ", "beforeQty": 26}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
159	\N	rack_a7	0	2026-08-11 20:48:29.483	47f93c10-d202-4b38-8c15-7038c217d905	IMPORT_REPLACE	{"sku": "BJ-TY017", "brand": "Toyota", "afterQty": 30, "category": "BJ", "beforeQty": 30}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
160	\N	rack_a8	0	2026-08-11 20:48:29.501	bb4fb561-1998-42e1-9bdd-790a7b0cb751	IMPORT_REPLACE	{"sku": "BJ-TY018", "brand": "Toyota", "afterQty": 34, "category": "BJ", "beforeQty": 34}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
161	\N	rack_a9	0	2026-08-11 20:48:29.518	0ff1d96f-73f1-43a2-865a-eddf0487b994	IMPORT_REPLACE	{"sku": "BJ-TY019", "brand": "Toyota", "afterQty": 38, "category": "BJ", "beforeQty": 38}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
162	\N	rack_a10	0	2026-08-11 20:48:29.54	51ac41e5-77f2-444d-b04f-2fb88f4ed643	IMPORT_REPLACE	{"sku": "BJ-TY020", "brand": "Toyota", "afterQty": 42, "category": "BJ", "beforeQty": 42}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
163	\N	rack_a11	0	2026-08-11 20:48:29.556	73ab2803-5078-4209-b334-8e8670c5630e	IMPORT_REPLACE	{"sku": "BJ-TY021", "brand": "Toyota", "afterQty": 46, "category": "BJ", "beforeQty": 46}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
164	\N	rack_a12	0	2026-08-11 20:48:29.576	03f1c318-9a7f-4122-854e-612b8ece1d7d	IMPORT_REPLACE	{"sku": "BJ-TY022", "brand": "Toyota", "afterQty": 50, "category": "BJ", "beforeQty": 50}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
165	\N	rack_a13	0	2026-08-11 20:48:29.595	ed32c415-4a1d-4235-a94d-8c8f19e4adf4	IMPORT_REPLACE	{"sku": "BJ-TY023", "brand": "Toyota", "afterQty": 54, "category": "BJ", "beforeQty": 54}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
166	\N	rack_a14	0	2026-08-11 20:48:29.615	df6d7d48-0a12-42a0-a689-132a751c8a77	IMPORT_REPLACE	{"sku": "BJ-TY024", "brand": "Toyota", "afterQty": 58, "category": "BJ", "beforeQty": 58}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
167	\N	rack_a15	0	2026-08-11 20:48:29.632	f2b4f786-bd41-488f-8b79-07217222a285	IMPORT_REPLACE	{"sku": "BJ-TY025", "brand": "Toyota", "afterQty": 62, "category": "BJ", "beforeQty": 62}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
168	\N	rack_a16	0	2026-08-11 20:48:29.648	29bae952-e458-422e-bdbf-dd57a0315b57	IMPORT_REPLACE	{"sku": "BJ-TY026", "brand": "Toyota", "afterQty": 66, "category": "BJ", "beforeQty": 66}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
169	\N	rack_a17	0	2026-08-11 20:48:29.663	474e07ea-c65c-4d85-8b48-ffeed99cefab	IMPORT_REPLACE	{"sku": "BJ-TY027", "brand": "Toyota", "afterQty": 70, "category": "BJ", "beforeQty": 70}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
170	\N	rack_a18	0	2026-08-11 20:48:29.678	3982c343-80b5-413d-825c-9e0f24c37558	IMPORT_REPLACE	{"sku": "BJ-TY028", "brand": "Toyota", "afterQty": 74, "category": "BJ", "beforeQty": 74}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
171	\N	rack_a19	0	2026-08-11 20:48:29.694	723537d5-7499-42c9-99b0-637265b4fcff	IMPORT_REPLACE	{"sku": "BJ-TY029", "brand": "Toyota", "afterQty": 78, "category": "BJ", "beforeQty": 78}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
172	\N	rack_a20	0	2026-08-11 20:48:29.71	1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	IMPORT_REPLACE	{"sku": "BJ-TY030", "brand": "Toyota", "afterQty": 82, "category": "BJ", "beforeQty": 82}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
173	\N	rack_a21	0	2026-08-11 20:48:29.723	5c31ef49-fef8-47b1-a006-6a2f728b5959	IMPORT_REPLACE	{"sku": "BJ-TY031", "brand": "Toyota", "afterQty": 86, "category": "BJ", "beforeQty": 86}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
174	\N	rack_a22	0	2026-08-11 20:48:29.741	05a28014-c1e9-4c5e-8762-5e8dc4505ade	IMPORT_REPLACE	{"sku": "BJ-TY032", "brand": "Toyota", "afterQty": 90, "category": "BJ", "beforeQty": 90}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
175	\N	rack_a23	0	2026-08-11 20:48:29.757	4f369f76-e6dc-4c0f-b412-046661db8a75	IMPORT_REPLACE	{"sku": "BJ-TY033", "brand": "Toyota", "afterQty": 94, "category": "BJ", "beforeQty": 94}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
176	\N	rack_a24	0	2026-08-11 20:48:29.774	646ed99b-feff-442b-b19c-d3baa7fdeb7f	IMPORT_REPLACE	{"sku": "BJ-TY034", "brand": "Toyota", "afterQty": 98, "category": "BJ", "beforeQty": 98}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
177	\N	rack_a25	0	2026-08-11 20:48:29.789	6f8c7632-171f-4b24-b544-3c25e5eeb83f	IMPORT_REPLACE	{"sku": "BJ-TY035", "brand": "Toyota", "afterQty": 102, "category": "BJ", "beforeQty": 102}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
178	\N	rack_a26	0	2026-08-11 20:48:29.805	a7d7852b-6626-4f68-970f-013d1ca0fb44	IMPORT_REPLACE	{"sku": "BJ-TY036", "brand": "Toyota", "afterQty": 106, "category": "BJ", "beforeQty": 106}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
179	\N	rack_a27	0	2026-08-11 20:48:29.82	92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	IMPORT_REPLACE	{"sku": "BJ-TY037", "brand": "Toyota", "afterQty": 110, "category": "BJ", "beforeQty": 110}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
180	\N	rack_a28	0	2026-08-11 20:48:29.834	6f89f946-6012-4c47-a963-3dfca7cc3111	IMPORT_REPLACE	{"sku": "BJ-TY038", "brand": "Toyota", "afterQty": 114, "category": "BJ", "beforeQty": 114}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
181	\N	rack_a29	0	2026-08-11 20:48:29.849	847fec76-9d32-420b-8829-bc3428892d6a	IMPORT_REPLACE	{"sku": "BJ-TY039", "brand": "Toyota", "afterQty": 118, "category": "BJ", "beforeQty": 118}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
182	\N	rack_a30	0	2026-08-11 20:48:29.862	991a1535-c776-44b6-b7e9-dc0d152f73c7	IMPORT_REPLACE	{"sku": "BJ-TY040", "brand": "Toyota", "afterQty": 122, "category": "BJ", "beforeQty": 122}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
183	\N	rack_a31	0	2026-08-11 20:48:29.878	225797d9-b623-4d3f-8973-6e05e589bf18	IMPORT_REPLACE	{"sku": "BJ-TY041", "brand": "Toyota", "afterQty": 126, "category": "BJ", "beforeQty": 126}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
184	\N	rack_a32	0	2026-08-11 20:48:29.898	27e26b8b-49cc-4c01-abe2-70667adfc37d	IMPORT_REPLACE	{"sku": "BJ-TY042", "brand": "Toyota", "afterQty": 130, "category": "BJ", "beforeQty": 130}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
185	\N	rack_a33	0	2026-08-11 20:48:29.915	f1e372dc-f83d-4f89-bc67-5eff737f0362	IMPORT_REPLACE	{"sku": "BJ-TY043", "brand": "Toyota", "afterQty": 134, "category": "BJ", "beforeQty": 134}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
186	\N	rack_a34	0	2026-08-11 20:48:29.931	1f9776ab-29d6-4b5c-94f9-b54a0a577736	IMPORT_REPLACE	{"sku": "BJ-TY044", "brand": "Toyota", "afterQty": 138, "category": "BJ", "beforeQty": 138}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
187	\N	rack_a35	0	2026-08-11 20:48:29.948	f1329b27-ef69-410e-bc28-cbcd43cf5a47	IMPORT_REPLACE	{"sku": "BJ-TY045", "brand": "Toyota", "afterQty": 142, "category": "BJ", "beforeQty": 142}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
188	\N	rack_a36	0	2026-08-11 20:48:29.962	7503ee98-8ab7-44f1-8afc-254f29e637aa	IMPORT_REPLACE	{"sku": "BJ-TY046", "brand": "Toyota", "afterQty": 146, "category": "BJ", "beforeQty": 146}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
189	\N	rack_a37	0	2026-08-11 20:48:29.979	a61b654f-a6ff-4353-8c3a-5f08765bf64e	IMPORT_REPLACE	{"sku": "BJ-TY047", "brand": "Toyota", "afterQty": 150, "category": "BJ", "beforeQty": 150}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
190	\N	rack_a38	0	2026-08-11 20:48:29.995	f4050299-3d13-414f-9fe3-ebf9d82b40ad	IMPORT_REPLACE	{"sku": "BJ-TY048", "brand": "Toyota", "afterQty": 154, "category": "BJ", "beforeQty": 154}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
191	\N	rack_a39	0	2026-08-11 20:48:30.014	32f34b55-a471-4fe8-a88d-e569c08d8246	IMPORT_REPLACE	{"sku": "BJ-TY049", "brand": "Toyota", "afterQty": 158, "category": "BJ", "beforeQty": 158}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
192	\N	rack_a40	0	2026-08-11 20:48:30.029	2a3a2b1c-855d-4c65-a133-624a510f4c30	IMPORT_REPLACE	{"sku": "BJ-TY050", "brand": "Toyota", "afterQty": 162, "category": "BJ", "beforeQty": 162}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
193	\N	rack_a41	0	2026-08-11 20:48:30.048	02058b49-1710-4d98-b4ce-22448191dfdf	IMPORT_REPLACE	{"sku": "BJ-TY051", "brand": "Toyota", "afterQty": 166, "category": "BJ", "beforeQty": 166}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
194	\N	rack_a42	0	2026-08-11 20:48:30.064	5e2fb9c7-9757-4f94-b720-0424944e347a	IMPORT_REPLACE	{"sku": "BJ-TY052", "brand": "Toyota", "afterQty": 170, "category": "BJ", "beforeQty": 170}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
195	\N	rack_a43	0	2026-08-11 20:48:30.08	7cae8090-8e69-41ce-ae47-83c1cce57e7b	IMPORT_REPLACE	{"sku": "BJ-TY053", "brand": "Toyota", "afterQty": 174, "category": "BJ", "beforeQty": 174}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
196	rack_a41	\N	1	2026-08-11 20:48:40.481	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	0c6d0b3b-862c-44b6-8e07-fb26519f74d4
197	rack_a41	\N	1	2026-08-11 20:49:39.194	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	dc84028c-95da-4cf1-81af-c8d397651b14
198	rack_a41	\N	1	2026-08-11 20:49:53.186	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	1826029d-d05b-4d54-a71b-b37606992698
199	rack_a41	\N	1	2026-08-11 21:12:20.181	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	fd69e31a-48fe-45e5-b456-457420193577
200	rack_a41	\N	1	2026-08-11 21:13:50.025	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	f2ae8c02-c90d-45f9-af1e-ec470b3a2475
201	rack_a41	\N	1	2026-08-11 21:26:25.144	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	456fd3b2-afd6-4cf4-90a5-d9298fef0624
202	rack_a41	\N	1	2026-08-11 21:31:06.213	02058b49-1710-4d98-b4ce-22448191dfdf	SALE	\N	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	eba926f9-de16-4b71-bd0b-3541f5cb47d3
203	\N	rack_a1	50	2026-08-14 09:27:52.436	f80785b1-9d11-4388-88e4-b65c61b0b83a	ADJUSTMENT	{"reason": "tambah"}	\N	\N	803dc602-6c99-4985-906b-8d4bafb1a033	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	\N
\.


--
-- Data for Name: ExternalOrder; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ExternalOrder" (id, "organizationId", "connectionId", "externalRef", "customerName", status, "sessionId", "createdAt") FROM stdin;
\.


--
-- Data for Name: ExternalOrderItem; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ExternalOrderItem" (id, "externalOrderId", "externalSku", quantity, "productId") FROM stdin;
\.


--
-- Data for Name: ExternalProductMapping; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ExternalProductMapping" (id, "connectionId", "productId", "externalSku") FROM stdin;
\.


--
-- Data for Name: Installation; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Installation" (id, fingerprint, "machineId", "createdAt") FROM stdin;
\.


--
-- Data for Name: IntegrationConnection; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."IntegrationConnection" (id, "organizationId", provider, "columnMapping", active, "createdAt") FROM stdin;
4e7f8f0a-0356-4cb9-9d3a-175ef53ac37a	803dc602-6c99-4985-906b-8d4bafb1a033	accurate	\N	t	2026-08-19 08:57:56.364
\.


--
-- Data for Name: Invoice; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Invoice" (id, "invoiceNumber", "organizationId", "locationId", format, status, "customerName", subtotal, discount, total, "userId", "createdAt", "issuedAt", "customerId", "amountPaid", "paymentStatus", "dueDate", "taxAmount", "vehicleId") FROM stdin;
0c6d0b3b-862c-44b6-8e07-fb26519f74d4	INV-2026-00001	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 20:48:40.405	2026-08-11 20:48:40.488	\N	0	UNPAID	\N	0.00	\N
dc84028c-95da-4cf1-81af-c8d397651b14	INV-2026-00002	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 20:49:39.139	2026-08-11 20:49:39.196	\N	0	UNPAID	\N	0.00	\N
1826029d-d05b-4d54-a71b-b37606992698	INV-2026-00003	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 20:49:53.126	2026-08-11 20:49:53.19	\N	0	UNPAID	\N	0.00	\N
fd69e31a-48fe-45e5-b456-457420193577	INV-2026-00004	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 21:12:20.102	2026-08-11 21:12:20.19	\N	0	UNPAID	\N	0.00	\N
f2ae8c02-c90d-45f9-af1e-ec470b3a2475	INV-2026-00005	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 21:13:49.975	2026-08-11 21:13:50.03	\N	0	UNPAID	\N	0.00	\N
456fd3b2-afd6-4cf4-90a5-d9298fef0624	INV-2026-00006	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 21:26:25.065	2026-08-11 21:26:25.154	\N	0	UNPAID	\N	0.00	\N
eba926f9-de16-4b71-bd0b-3541f5cb47d3	INV-2026-00007	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-11 21:31:06.133	2026-08-11 21:31:06.221	\N	0	UNPAID	\N	0.00	\N
aab9f7f5-ad8d-447c-8ecc-15adadb5517a	INV-2026-00011	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 00:04:25.505	2026-08-13 00:08:22.913	\N	0	UNPAID	\N	0.00	\N
70aa48f8-4068-44f6-b50e-0bd689409b9c	INV-2026-00012	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:08:07.311	2026-08-13 07:08:07.397	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
9c4fc76c-586e-4ece-b8c2-464e665753ac	INV-2026-00020	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a1	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:31:16.544	2026-08-13 08:29:33.149	\N	0	UNPAID	\N	0.00	\N
69b46971-254c-490c-a722-208d8deb898c	INV-2026-00013	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	Adit	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:08:07.336	2026-08-13 07:09:03.239	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
2a5b398e-002d-4294-b2b9-3e16dd4bfd4b	INV-2026-00014	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	Adit	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:08:07.453	2026-08-13 07:10:30.32	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
fac086ed-7ea0-409c-8173-fb79d8272c8a	INV-2026-00009	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-12 21:06:27.646	2026-08-12 21:06:27.715	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
14f585b6-919b-4a72-83e7-7577cf6ee96d	INV-2026-00008	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-12 20:03:45.055	2026-08-12 20:04:06.588	\N	0	UNPAID	\N	0.00	\N
81c75bf7-75a8-482f-a1e7-51828f974b6d	INV-2026-00010	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-12 21:06:27.805	2026-08-12 21:06:53.002	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
88598d57-8da0-49dc-a8c9-a195e4e8557e	INV-2026-00023	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:42:50.03	2026-08-13 08:42:50.353	\N	0	UNPAID	\N	0.00	\N
2dd330d2-c52c-4f51-9a04-adbb2342e5a4	INV-2026-00018	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:12:31.965	2026-08-13 07:12:43.35	\N	0	UNPAID	\N	0.00	\N
abe898f6-ae40-416d-9f6a-16c08ec106b9	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	DRAFT	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:30:16.892	\N	\N	0	UNPAID	\N	0.00	\N
29ab47f3-0923-41c4-8a4f-d5264a21e018	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	DRAFT	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:42:50.029	\N	\N	0	UNPAID	\N	0.00	\N
f3febfc2-1719-43cd-b2b7-daa803fb9cba	INV-2026-00021	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a1	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:31:16.312	2026-08-13 08:29:52.285	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
c6ee7398-4e8e-4103-906b-560dc5f8b3aa	INV-2026-00015	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:10:40.504	2026-08-13 07:11:57.38	\N	0	UNPAID	\N	0.00	\N
9dad7bfd-9121-4456-87d4-b75ae4b5708d	INV-2026-00016	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:12:03.042	2026-08-13 07:12:18.704	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
2793620d-3117-490c-b122-36a301caf8eb	INV-2026-00017	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:12:31.787	2026-08-13 07:12:31.855	\N	0	UNPAID	\N	0.00	\N
c3baf918-9107-4cd1-b94c-37d9d9db294a	INV-2026-00019	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 07:12:55.661	2026-08-13 07:30:37.198	\N	0	UNPAID	\N	0.00	\N
090dbb4a-d74d-459b-902a-144fbeba1991	INV-2026-00022	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:30:17.101	2026-08-13 08:30:37.148	\N	0	UNPAID	\N	0.00	\N
118cf543-ce1d-49f7-b1dd-1c0e2863d59d	INV-2026-00024	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:42:50.229	2026-08-13 08:43:00.09	\N	0	UNPAID	\N	0.00	\N
86f74870-bba5-4cae-951a-a6fb8e26da70	INV-2026-00025	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	300000.00	0.00	300000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:43:12.609	2026-08-13 08:43:26.404	\N	0	UNPAID	\N	0.00	\N
ef54cec3-6b7b-4034-a048-0415a1f70d17	INV-2026-00026	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 08:43:12.413	2026-08-13 11:26:34.182	\N	0	UNPAID	\N	0.00	\N
7b4b6f9d-8e60-4b67-b08a-158b0b1ba9b9	INV-2026-00031	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a1	A5	ISSUED	\N	150000.00	0.00	166500.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 11:59:49.292	2026-08-13 11:59:54.182	cmsqkfzds0001uo01byz05v8v	166500	PAID	\N	16500.00	\N
a21cf83b-3ded-4424-9311-625755cf4a8a	INV-2026-00030	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	300000.00	0.00	333000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 11:48:51.226	2026-08-13 11:49:04.893	cmsqkfzds0001uo01byz05v8v	160000	PARTIAL	\N	33000.00	\N
36264599-3802-4a03-9a57-bde33ddb73e8	INV-2026-00029	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a1	RECEIPT	ISSUED	\N	300000.00	0.00	300000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 11:29:24.916	2026-08-13 11:47:41.15	cmsqkfzds0001uo01byz05v8v	300000	PAID	\N	0.00	\N
ff1c718d-9b19-4f63-b52c-04fc70eb9bb6	INV-2026-00028	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a1	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 11:29:23.59	2026-08-13 11:29:23.621	\N	150000	PAID	\N	0.00	\N
ba9a89c5-91a9-4041-8b42-f0ebdb2ca064	INV-2026-00027	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	b	450000.00	0.00	450000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 11:27:11.09	2026-08-13 11:27:31.331	\N	450000	PAID	\N	0.00	\N
96cb36ef-acca-41c1-a97f-98c5ec80b936	INV-2026-00032	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 15:12:55.611	2026-08-13 15:13:10.45	\N	0	UNPAID	\N	0.00	\N
34d2cc17-8a16-4923-9484-9219bdb0039d	INV-2026-00040	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:51:49.404	2026-08-19 19:52:00.827	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	cmsxm6y1y0001ln011bjeyc9q
eba59c76-8314-42c1-882a-03fadaaf0197	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	DRAFT	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-13 15:13:22.602	\N	\N	0	UNPAID	\N	0.00	\N
3069b15e-3817-4114-ac47-b0cbf7c341a0	INV-2026-00041	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:53:46.057	2026-08-19 19:53:47.298	cmt0id8xg000hq601cjfbxwul	0	UNPAID	\N	0.00	cmt0ie4mx000jq601qrebkrc4
2d744741-e4ea-4915-9104-d2be9dd654da	INV-2026-00033	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-14 09:24:26.608	2026-08-14 09:24:41.71	\N	0	UNPAID	\N	0.00	\N
521fb32f-cd84-4cae-b7f2-9d44e60c61ea	INV-2026-00037	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	ba	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-18 08:03:25.142	2026-08-18 08:04:24.112	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	cmsxm6y1y0001ln011bjeyc9q
deb4672e-6c8e-4e5b-8bbc-d05eba56273d	INV-2026-00042	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:53:59.062	2026-08-19 19:54:09.356	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	cmt0ief5f000lq601yi2byxbd
aaeb86d6-7c5c-4cd9-92d5-cae9c38b3445	INV-2026-00034	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-17 19:12:26.609	2026-08-17 19:17:01.689	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	\N
cc8bc22f-a556-4aae-b073-f72c5c5eb64a	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	DRAFT	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 09:16:12.479	\N	\N	0	UNPAID	\N	0.00	\N
d3153136-c562-489a-8ebe-9ad0480bfa6c	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	DRAFT	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:36:19.843	\N	\N	0	UNPAID	\N	0.00	\N
ace36d99-02d3-4a00-bf03-e40577c9cf1c	INV-2026-00038	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:36:19.94	2026-08-19 19:36:20.066	\N	0	UNPAID	\N	0.00	\N
d7dee31c-b23d-46db-9e6d-712eae26d197	INV-2026-00035	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	RECEIPT	ISSUED	\N	150000.00	0.00	150000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-14 09:25:40.093	2026-08-18 07:49:26.314	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	cmsxm6y1y0001ln011bjeyc9q
5a560187-5421-4c95-8145-6b5235a8cdfd	\N	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	DRAFT	\N	300000.00	0.00	300000.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-20 02:41:17.156	\N	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	0.00	cmt0ief5f000lq601yi2byxbd
b2bda718-c03c-4011-8863-10dc82666d7a	INV-2026-00036	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	270000.00	0.00	286500.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-18 08:00:10.285	2026-08-18 08:00:22.849	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	16500.00	cmsxm6y1y0001ln011bjeyc9q
0326ee71-f93a-4a20-bf13-0b83d143b7ac	INV-2026-00039	803dc602-6c99-4985-906b-8d4bafb1a033	rack_a41	A5	ISSUED	\N	150000.00	0.00	166500.00	71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	2026-08-19 19:49:27.712	2026-08-19 19:51:17.123	cmsqkfzds0001uo01byz05v8v	0	UNPAID	\N	16500.00	cmsxm6y1y0001ln011bjeyc9q
\.


--
-- Data for Name: InvoiceItem; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvoiceItem" (id, "invoiceId", "productId", quantity, "unitPrice", "unitCost", "lineTotal", "taxAmount", total, "locationId", description) FROM stdin;
1	0c6d0b3b-862c-44b6-8e07-fb26519f74d4	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
2	dc84028c-95da-4cf1-81af-c8d397651b14	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
3	1826029d-d05b-4d54-a71b-b37606992698	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
4	fd69e31a-48fe-45e5-b456-457420193577	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
5	f2ae8c02-c90d-45f9-af1e-ec470b3a2475	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
6	456fd3b2-afd6-4cf4-90a5-d9298fef0624	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
7	eba926f9-de16-4b71-bd0b-3541f5cb47d3	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
158	c3baf918-9107-4cd1-b94c-37d9d9db294a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
161	9c4fc76c-586e-4ece-b8c2-464e665753ac	f80785b1-9d11-4388-88e4-b65c61b0b83a	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a1	\N
89	14f585b6-919b-4a72-83e7-7577cf6ee96d	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
166	f3febfc2-1719-43cd-b2b7-daa803fb9cba	f80785b1-9d11-4388-88e4-b65c61b0b83a	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a1	\N
169	090dbb4a-d74d-459b-902a-144fbeba1991	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
171	88598d57-8da0-49dc-a8c9-a195e4e8557e	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
174	118cf543-ce1d-49f7-b1dd-1c0e2863d59d	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
179	86f74870-bba5-4cae-951a-a6fb8e26da70	02058b49-1710-4d98-b4ce-22448191dfdf	2	150000.00	100000.00	300000.00	0.00	0.00	rack_a41	\N
181	abe898f6-ae40-416d-9f6a-16c08ec106b9	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
182	29ab47f3-0923-41c4-8a4f-d5264a21e018	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
264	d3153136-c562-489a-8ebe-9ad0480bfa6c	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
113	fac086ed-7ea0-409c-8173-fb79d8272c8a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
117	81c75bf7-75a8-482f-a1e7-51828f974b6d	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
122	aab9f7f5-ad8d-447c-8ecc-15adadb5517a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
123	70aa48f8-4068-44f6-b50e-0bd689409b9c	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
128	69b46971-254c-490c-a722-208d8deb898c	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
265	ace36d99-02d3-4a00-bf03-e40577c9cf1c	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
129	2a5b398e-002d-4294-b2b9-3e16dd4bfd4b	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
136	c6ee7398-4e8e-4103-906b-560dc5f8b3aa	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
147	9dad7bfd-9121-4456-87d4-b75ae4b5708d	03f1c318-9a7f-4122-854e-612b8ece1d7d	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
148	2793620d-3117-490c-b122-36a301caf8eb	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
153	2dd330d2-c52c-4f51-9a04-adbb2342e5a4	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	0.00	rack_a41	\N
189	ef54cec3-6b7b-4034-a048-0415a1f70d17	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
270	0326ee71-f93a-4a20-bf13-0b83d143b7ac	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	16500.00	166500.00	rack_a41	\N
273	34d2cc17-8a16-4923-9484-9219bdb0039d	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
196	ba9a89c5-91a9-4041-8b42-f0ebdb2ca064	02058b49-1710-4d98-b4ce-22448191dfdf	2	150000.00	100000.00	300000.00	0.00	300000.00	rack_a41	\N
197	ba9a89c5-91a9-4041-8b42-f0ebdb2ca064	03f1c318-9a7f-4122-854e-612b8ece1d7d	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a12	\N
198	ff1c718d-9b19-4f63-b52c-04fc70eb9bb6	f80785b1-9d11-4388-88e4-b65c61b0b83a	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a1	\N
275	3069b15e-3817-4114-ac47-b0cbf7c341a0	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
277	deb4672e-6c8e-4e5b-8bbc-d05eba56273d	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
205	36264599-3802-4a03-9a57-bde33ddb73e8	f80785b1-9d11-4388-88e4-b65c61b0b83a	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a1	\N
206	36264599-3802-4a03-9a57-bde33ddb73e8	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
216	a21cf83b-3ded-4424-9311-625755cf4a8a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	16500.00	166500.00	rack_a41	\N
217	a21cf83b-3ded-4424-9311-625755cf4a8a	05a28014-c1e9-4c5e-8762-5e8dc4505ade	1	150000.00	100000.00	150000.00	16500.00	166500.00	rack_a22	\N
221	7b4b6f9d-8e60-4b67-b08a-158b0b1ba9b9	f80785b1-9d11-4388-88e4-b65c61b0b83a	1	150000.00	100000.00	150000.00	16500.00	166500.00	rack_a1	\N
223	96cb36ef-acca-41c1-a97f-98c5ec80b936	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
228	eba59c76-8314-42c1-882a-03fadaaf0197	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
232	2d744741-e4ea-4915-9104-d2be9dd654da	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
238	aaeb86d6-7c5c-4cd9-92d5-cae9c38b3445	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
242	d7dee31c-b23d-46db-9e6d-712eae26d197	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
250	b2bda718-c03c-4011-8863-10dc82666d7a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	16500.00	166500.00	rack_a41	\N
251	b2bda718-c03c-4011-8863-10dc82666d7a	\N	1	120000.00	\N	120000.00	0.00	120000.00	\N	Ganti Oli
259	521fb32f-cd84-4cae-b7f2-9d44e60c61ea	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
263	cc8bc22f-a556-4aae-b073-f72c5c5eb64a	02058b49-1710-4d98-b4ce-22448191dfdf	1	150000.00	100000.00	150000.00	0.00	150000.00	rack_a41	\N
281	5a560187-5421-4c95-8145-6b5235a8cdfd	02058b49-1710-4d98-b4ce-22448191dfdf	2	150000.00	100000.00	300000.00	0.00	300000.00	rack_a41	\N
\.


--
-- Data for Name: InvoiceItemTax; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvoiceItemTax" (id, "invoiceItemId", "taxRateId", name, percentage, amount) FROM stdin;
cmsrggh5c000hs101jfnccpx4	216	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmsrggh5c000js1012w2udxqu	217	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmsrgue5a0005pc01ayap0dmk	221	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmsydhmgp0005ms01320biatz	250	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmt0ibpe60009q601kslgmzv7	270	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
\.


--
-- Data for Name: InvoiceTax; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvoiceTax" (id, "invoiceId", "taxRateId", name, percentage, amount) FROM stdin;
cmsrggh5c000ls101uak7mn0x	a21cf83b-3ded-4424-9311-625755cf4a8a	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	33000.00
cmsrgue5b0007pc01dl3t966v	7b4b6f9d-8e60-4b67-b08a-158b0b1ba9b9	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmsydhmgp0007ms01w5ge4l0u	b2bda718-c03c-4011-8863-10dc82666d7a	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
cmt0ibpe6000bq601n4mbktit	0326ee71-f93a-4a20-bf13-0b83d143b7ac	9e4c6534-5622-4c7d-bb3a-17f62c44e632	PPN	11.00	16500.00
\.


--
-- Data for Name: License; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."License" (id, key, "customerName", "branchName", domain, status, "issuedAt", "expiresAt", "lastCheckIn") FROM stdin;
\.


--
-- Data for Name: Location; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Location" (id, name, "createdAt", "organizationId", "archivedAt", address, phone) FROM stdin;
rack_a1	Rack A1	2026-08-09 08:34:53.415	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a2	Rack A2	2026-08-09 08:34:53.467	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a3	Rack A3	2026-08-09 08:34:53.499	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a4	Rack A4	2026-08-09 08:34:53.531	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a5	Rack A5	2026-08-09 08:34:53.564	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a6	Rack A6	2026-08-09 08:34:53.598	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a7	Rack A7	2026-08-09 08:34:53.628	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a8	Rack A8	2026-08-09 08:34:53.656	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a9	Rack A9	2026-08-09 08:34:53.685	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a10	Rack A10	2026-08-09 08:34:53.716	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a11	Rack A11	2026-08-09 08:34:53.744	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a12	Rack A12	2026-08-09 08:34:53.772	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a13	Rack A13	2026-08-09 08:34:53.801	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a14	Rack A14	2026-08-09 08:34:53.833	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a15	Rack A15	2026-08-09 08:34:53.863	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a16	Rack A16	2026-08-09 08:34:53.893	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a17	Rack A17	2026-08-09 08:34:53.922	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a18	Rack A18	2026-08-09 08:34:53.951	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a19	Rack A19	2026-08-09 08:34:53.98	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a20	Rack A20	2026-08-09 08:34:54.01	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a21	Rack A21	2026-08-09 08:34:54.038	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a22	Rack A22	2026-08-09 08:34:54.065	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a23	Rack A23	2026-08-09 08:34:54.092	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a24	Rack A24	2026-08-09 08:34:54.119	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a25	Rack A25	2026-08-09 08:34:54.146	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a26	Rack A26	2026-08-09 08:34:54.174	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a27	Rack A27	2026-08-09 08:34:54.2	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a28	Rack A28	2026-08-09 08:34:54.226	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a29	Rack A29	2026-08-09 08:34:54.253	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a30	Rack A30	2026-08-09 08:34:54.279	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a31	Rack A31	2026-08-09 08:34:54.306	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a32	Rack A32	2026-08-09 08:34:54.334	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a33	Rack A33	2026-08-09 08:34:54.363	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a34	Rack A34	2026-08-09 08:34:54.399	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a35	Rack A35	2026-08-09 08:34:54.428	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a36	Rack A36	2026-08-09 08:34:54.455	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a37	Rack A37	2026-08-09 08:34:54.483	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a38	Rack A38	2026-08-09 08:34:54.512	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a39	Rack A39	2026-08-09 08:34:54.543	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a40	Rack A40	2026-08-09 08:34:54.574	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a41	Rack A41	2026-08-09 08:34:54.603	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a42	Rack A42	2026-08-09 08:34:54.631	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
rack_a43	Rack A43	2026-08-09 08:34:54.658	803dc602-6c99-4985-906b-8d4bafb1a033	\N	\N	\N
\.


--
-- Data for Name: Organization; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Organization" (id, name, plan, "seatLimit", "createdAt", "fulfillmentMode", "posPricingEnabled", "bankAccountName", "bankAccountNumber", "bankName", "legalName", "logoUrl", npwp, "taxEnabled", "taxName", "taxPercentage") FROM stdin;
d6b797d6-2639-45af-885e-4acd0938ddaa	PT SRIWIJAYA	free	1	2026-08-11 09:33:38.564	PICK_SHIP	f	\N	\N	\N	\N	\N	\N	f	\N	\N
803dc602-6c99-4985-906b-8d4bafb1a033	WareSys	free	1	2026-08-08 17:02:31.235	PICK_PACK_SHIP	t	\N	\N	\N	\N	/uploads/logos/803dc602-6c99-4985-906b-8d4bafb1a033-6d7442a9-cb31-4904-838b-7c093535a747.png	\N	f	\N	\N
ad4a5bd9-60c0-4a72-bc19-01bba25db640	Demo	free	1	2026-08-20 17:02:41.614	PICK_PACK_SHIP	f	\N	\N	\N	\N	/uploads/logos/ad4a5bd9-60c0-4a72-bc19-01bba25db640-4edfc056-4727-40c1-b6f4-0b76d3063786.png	\N	f	\N	\N
\.


--
-- Data for Name: OrganizationModule; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."OrganizationModule" (id, "organizationId", module, enabled, "activatedAt", "expiresAt") FROM stdin;
c3ea885f-e91c-464c-9244-9413a1b1941e	803dc602-6c99-4985-906b-8d4bafb1a033	INVOICE_POS	t	2026-08-10 11:05:46.501	\N
ae0ae559-3062-4232-9889-59e8c7aa476b	d6b797d6-2639-45af-885e-4acd0938ddaa	INVOICE_POS	t	2026-08-11 10:19:09.9	\N
19940309-ea1f-4b32-9779-c541076896fd	803dc602-6c99-4985-906b-8d4bafb1a033	WAREHOUSE_OPS	t	2026-08-11 09:30:10.231	\N
c92e395d-58b2-4f3d-b627-5592b7793621	803dc602-6c99-4985-906b-8d4bafb1a033	WORKSHOP_RMS	t	2026-08-17 19:11:34.793	\N
f200c81c-7587-4378-94c8-c039c9413cab	ad4a5bd9-60c0-4a72-bc19-01bba25db640	WORKSHOP_RMS	t	2026-08-20 17:04:48.819	\N
26ba44b6-9cdf-4af4-ba79-889f71881c99	ad4a5bd9-60c0-4a72-bc19-01bba25db640	INVOICE_POS	t	2026-08-20 17:05:09.932	\N
\.


--
-- Data for Name: OrganizationTaxRate; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."OrganizationTaxRate" (id, "organizationId", name, percentage, "createdAt", "archivedAt", "isDefault") FROM stdin;
bad49de2-4d7e-4524-8e65-ec42ac7dacd9	803dc602-6c99-4985-906b-8d4bafb1a033	PPN	11.00	2026-08-13 08:49:30.065	2026-08-13 08:49:32.076	f
9e4c6534-5622-4c7d-bb3a-17f62c44e632	803dc602-6c99-4985-906b-8d4bafb1a033	PPN	11.00	2026-08-13 11:48:19.162	\N	t
\.


--
-- Data for Name: Payment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Payment" (id, "invoiceId", amount, method, note, "recordedById", "createdAt") FROM stdin;
cmsrmc9g30001oa01u9v54f5c	7b4b6f9d-8e60-4b67-b08a-158b0b1ba9b9	166500	CASH	\N	\N	2026-08-13 14:33:45.939
cmsrmcx7w0003oa01s6bagiau	a21cf83b-3ded-4424-9311-625755cf4a8a	160000	CASH	\N	\N	2026-08-13 14:34:16.749
cmsrn11f50001lq013kmr4fll	36264599-3802-4a03-9a57-bde33ddb73e8	300000	CASH	\N	\N	2026-08-13 14:53:01.937
cmsrn8xf60003lq0170ub58hs	ff1c718d-9b19-4f63-b52c-04fc70eb9bb6	150000	CASH	\N	\N	2026-08-13 14:59:10.002
cmsrndwar0005lq01yh6acggw	ba9a89c5-91a9-4041-8b42-f0ebdb2ca064	450000	CASH	\N	\N	2026-08-13 15:03:01.827
\.


--
-- Data for Name: Product; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Product" (id, name, "createdAt", "categoryId", active, "brandId", sku, oem, "organizationId", barcode, "costPrice", "sellingPrice") FROM stdin;
47f93c10-d202-4b38-8c15-7038c217d905	Ball Joint	2026-08-09 08:34:53.623	bj	t	toyota	BJ-TY017	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
bb4fb561-1998-42e1-9bdd-790a7b0cb751	Ball Joint	2026-08-09 08:34:53.651	bj	t	toyota	BJ-TY018	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
0ff1d96f-73f1-43a2-865a-eddf0487b994	Ball Joint	2026-08-09 08:34:53.68	bj	t	toyota	BJ-TY019	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
51ac41e5-77f2-444d-b04f-2fb88f4ed643	Ball Joint	2026-08-09 08:34:53.71	bj	t	toyota	BJ-TY020	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
73ab2803-5078-4209-b334-8e8670c5630e	Ball Joint	2026-08-09 08:34:53.739	bj	t	toyota	BJ-TY021	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
03f1c318-9a7f-4122-854e-612b8ece1d7d	Ball Joint	2026-08-09 08:34:53.767	bj	t	toyota	BJ-TY022	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
ed32c415-4a1d-4235-a94d-8c8f19e4adf4	Ball Joint	2026-08-09 08:34:53.796	bj	t	toyota	BJ-TY023	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
df6d7d48-0a12-42a0-a689-132a751c8a77	Ball Joint	2026-08-09 08:34:53.828	bj	t	toyota	BJ-TY024	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f2b4f786-bd41-488f-8b79-07217222a285	Ball Joint	2026-08-09 08:34:53.857	bj	t	toyota	BJ-TY025	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
29bae952-e458-422e-bdbf-dd57a0315b57	Ball Joint	2026-08-09 08:34:53.887	bj	t	toyota	BJ-TY026	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
474e07ea-c65c-4d85-8b48-ffeed99cefab	Ball Joint	2026-08-09 08:34:53.917	bj	t	toyota	BJ-TY027	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
3982c343-80b5-413d-825c-9e0f24c37558	Ball Joint	2026-08-09 08:34:53.945	bj	t	toyota	BJ-TY028	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
723537d5-7499-42c9-99b0-637265b4fcff	Ball Joint	2026-08-09 08:34:53.974	bj	t	toyota	BJ-TY029	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	Ball Joint	2026-08-09 08:34:54.004	bj	t	toyota	BJ-TY030	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
5c31ef49-fef8-47b1-a006-6a2f728b5959	Ball Joint	2026-08-09 08:34:54.033	bj	t	toyota	BJ-TY031	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
05a28014-c1e9-4c5e-8762-5e8dc4505ade	Ball Joint	2026-08-09 08:34:54.06	bj	t	toyota	BJ-TY032	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
4f369f76-e6dc-4c0f-b412-046661db8a75	Ball Joint	2026-08-09 08:34:54.087	bj	t	toyota	BJ-TY033	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
646ed99b-feff-442b-b19c-d3baa7fdeb7f	Ball Joint	2026-08-09 08:34:54.114	bj	t	toyota	BJ-TY034	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
6f8c7632-171f-4b24-b544-3c25e5eeb83f	Ball Joint	2026-08-09 08:34:54.14	bj	t	toyota	BJ-TY035	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
a7d7852b-6626-4f68-970f-013d1ca0fb44	Ball Joint	2026-08-09 08:34:54.169	bj	t	toyota	BJ-TY036	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	Ball Joint	2026-08-09 08:34:54.195	bj	t	toyota	BJ-TY037	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
6f89f946-6012-4c47-a963-3dfca7cc3111	Ball Joint	2026-08-09 08:34:54.221	bj	t	toyota	BJ-TY038	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
847fec76-9d32-420b-8829-bc3428892d6a	Ball Joint	2026-08-09 08:34:54.248	bj	t	toyota	BJ-TY039	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
991a1535-c776-44b6-b7e9-dc0d152f73c7	Ball Joint	2026-08-09 08:34:54.274	bj	t	toyota	BJ-TY040	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
225797d9-b623-4d3f-8973-6e05e589bf18	Ball Joint	2026-08-09 08:34:54.301	bj	t	toyota	BJ-TY041	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
27e26b8b-49cc-4c01-abe2-70667adfc37d	Ball Joint	2026-08-09 08:34:54.329	bj	t	toyota	BJ-TY042	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f1e372dc-f83d-4f89-bc67-5eff737f0362	Ball Joint	2026-08-09 08:34:54.358	bj	t	toyota	BJ-TY043	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
1f9776ab-29d6-4b5c-94f9-b54a0a577736	Ball Joint	2026-08-09 08:34:54.39	bj	t	toyota	BJ-TY044	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f1329b27-ef69-410e-bc28-cbcd43cf5a47	Ball Joint	2026-08-09 08:34:54.423	bj	t	toyota	BJ-TY045	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
7503ee98-8ab7-44f1-8afc-254f29e637aa	Ball Joint	2026-08-09 08:34:54.45	bj	t	toyota	BJ-TY046	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
a61b654f-a6ff-4353-8c3a-5f08765bf64e	Ball Joint	2026-08-09 08:34:54.478	bj	t	toyota	BJ-TY047	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f4050299-3d13-414f-9fe3-ebf9d82b40ad	Ball Joint	2026-08-09 08:34:54.506	bj	t	toyota	BJ-TY048	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
32f34b55-a471-4fe8-a88d-e569c08d8246	Ball Joint	2026-08-09 08:34:54.537	bj	t	toyota	BJ-TY049	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
2a3a2b1c-855d-4c65-a133-624a510f4c30	Ball Joint	2026-08-09 08:34:54.569	bj	t	toyota	BJ-TY050	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
02058b49-1710-4d98-b4ce-22448191dfdf	Ball Joint	2026-08-09 08:34:54.598	bj	t	toyota	BJ-TY051	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
5e2fb9c7-9757-4f94-b720-0424944e347a	Ball Joint	2026-08-09 08:34:54.626	bj	t	toyota	BJ-TY052	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
7cae8090-8e69-41ce-ae47-83c1cce57e7b	Ball Joint	2026-08-09 08:34:54.653	bj	t	toyota	BJ-TY053	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f80785b1-9d11-4388-88e4-b65c61b0b83a	Ball Joint	2026-08-09 08:34:53.402	bj	t	toyota	BJ-TY011	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
f2aadfd5-84fc-4092-bcd6-a1798827e626	Ball Joint	2026-08-09 08:34:53.461	bj	t	toyota	BJ-TY012	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
b6524d27-6618-40a8-8ebb-c36dc6721ddd	Ball Joint	2026-08-09 08:34:53.493	bj	t	toyota	BJ-TY013	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
77437287-019c-46c5-81ea-cdb54d2a7d66	Ball Joint	2026-08-09 08:34:53.525	bj	t	toyota	BJ-TY014	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	Ball Joint	2026-08-09 08:34:53.558	bj	t	toyota	BJ-TY015	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
9289ad06-6dcd-4b7b-976c-c110a91bf5d7	Ball Joint	2026-08-09 08:34:53.591	bj	t	toyota	BJ-TY016	\N	803dc602-6c99-4985-906b-8d4bafb1a033	\N	100000.00	150000.00
\.


--
-- Data for Name: Session; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Session" (id, status, "createdAt", "completedAt", "organizationId", type, stage, "invoiceId") FROM stdin;
cmskmmv5z0001ms01jc7o0h1e	COMPLETED	2026-08-08 17:07:37.415	2026-08-08 17:07:40.311	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	SHIP	\N
cmsmokvoe0001s701uqy8sx1y	OPEN	2026-08-10 03:37:36.35	\N	803dc602-6c99-4985-906b-8d4bafb1a033	RECEIVE	\N	\N
cmsojd55c0001mp01t72qyzma	OPEN	2026-08-11 10:47:09.648	\N	803dc602-6c99-4985-906b-8d4bafb1a033	RECEIVE	\N	\N
cmsox14p60001mr01eeq4vfe9	OPEN	2026-08-11 17:09:43.818	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	\N
cmsp4v2lz0001mr01nrvpbfhg	COMPLETED	2026-08-11 20:48:58.103	2026-08-13 11:47:55.81	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	SHIP	\N
cmsrgue6o0009pc01oyhxl8ku	OPEN	2026-08-13 11:59:54.192	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	7b4b6f9d-8e60-4b67-b08a-158b0b1ba9b9
cmsrnqxx80001p901qynqufsk	OPEN	2026-08-13 15:13:10.46	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	96cb36ef-acca-41c1-a97f-98c5ec80b936
cmssqqnba0005mm01oy4lak2i	OPEN	2026-08-14 09:24:41.735	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	2d744741-e4ea-4915-9104-d2be9dd654da
cmsxm7y4i0003ln018mqvbe1t	OPEN	2026-08-17 19:17:01.698	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	aaeb86d6-7c5c-4cd9-92d5-cae9c38b3445
cmsyd3jy00001o901krs608no	OPEN	2026-08-18 07:49:26.328	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	d7dee31c-b23d-46db-9e6d-712eae26d197
cmsydhmj50009ms014x4wi3ne	OPEN	2026-08-18 08:00:22.865	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	b2bda718-c03c-4011-8863-10dc82666d7a
cmsydmsot000bms01zo0dc6go	OPEN	2026-08-18 08:04:24.125	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	521fb32f-cd84-4cae-b7f2-9d44e60c61ea
cmt0hsh9s0001q601vxwgedsv	OPEN	2026-08-19 19:36:20.08	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	ace36d99-02d3-4a00-bf03-e40577c9cf1c
cmt0ibpg2000dq601hqayqd22	OPEN	2026-08-19 19:51:17.139	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	0326ee71-f93a-4a20-bf13-0b83d143b7ac
cmt0icn5x000fq601ib5vg3kp	OPEN	2026-08-19 19:52:00.838	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	34d2cc17-8a16-4923-9484-9219bdb0039d
cmt0iexbe000pq60109n7uwqs	OPEN	2026-08-19 19:53:47.307	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	3069b15e-3817-4114-ac47-b0cbf7c341a0
cmt0ifec7000tq601rab0exqm	OPEN	2026-08-19 19:54:09.368	\N	803dc602-6c99-4985-906b-8d4bafb1a033	FULFILLMENT	PICK	deb4672e-6c8e-4e5b-8bbc-d05eba56273d
\.


--
-- Data for Name: SessionItem; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."SessionItem" (id, "sessionId", "productId", quantity) FROM stdin;
\.


--
-- Data for Name: SessionNote; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."SessionNote" (id, "sessionId", note, "userId", "createdAt") FROM stdin;
\.


--
-- Data for Name: SessionReopenEvent; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."SessionReopenEvent" (id, "sessionId", reason, "userId", "createdAt") FROM stdin;
\.


--
-- Data for Name: Stock; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Stock" (id, "productId", "locationId", quantity, "organizationId") FROM stdin;
9	0ff1d96f-73f1-43a2-865a-eddf0487b994	rack_a9	38	803dc602-6c99-4985-906b-8d4bafb1a033
10	51ac41e5-77f2-444d-b04f-2fb88f4ed643	rack_a10	42	803dc602-6c99-4985-906b-8d4bafb1a033
24	646ed99b-feff-442b-b19c-d3baa7fdeb7f	rack_a24	98	803dc602-6c99-4985-906b-8d4bafb1a033
25	6f8c7632-171f-4b24-b544-3c25e5eeb83f	rack_a25	102	803dc602-6c99-4985-906b-8d4bafb1a033
26	a7d7852b-6626-4f68-970f-013d1ca0fb44	rack_a26	106	803dc602-6c99-4985-906b-8d4bafb1a033
27	92be7197-94b1-4bb2-9cf3-d2a9b82b1ba3	rack_a27	110	803dc602-6c99-4985-906b-8d4bafb1a033
28	6f89f946-6012-4c47-a963-3dfca7cc3111	rack_a28	114	803dc602-6c99-4985-906b-8d4bafb1a033
29	847fec76-9d32-420b-8829-bc3428892d6a	rack_a29	118	803dc602-6c99-4985-906b-8d4bafb1a033
39	32f34b55-a471-4fe8-a88d-e569c08d8246	rack_a39	158	803dc602-6c99-4985-906b-8d4bafb1a033
40	2a3a2b1c-855d-4c65-a133-624a510f4c30	rack_a40	162	803dc602-6c99-4985-906b-8d4bafb1a033
42	5e2fb9c7-9757-4f94-b720-0424944e347a	rack_a42	170	803dc602-6c99-4985-906b-8d4bafb1a033
43	7cae8090-8e69-41ce-ae47-83c1cce57e7b	rack_a43	174	803dc602-6c99-4985-906b-8d4bafb1a033
41	02058b49-1710-4d98-b4ce-22448191dfdf	rack_a41	159	803dc602-6c99-4985-906b-8d4bafb1a033
1	f80785b1-9d11-4388-88e4-b65c61b0b83a	rack_a1	55	803dc602-6c99-4985-906b-8d4bafb1a033
2	f2aadfd5-84fc-4092-bcd6-a1798827e626	rack_a2	10	803dc602-6c99-4985-906b-8d4bafb1a033
3	b6524d27-6618-40a8-8ebb-c36dc6721ddd	rack_a3	14	803dc602-6c99-4985-906b-8d4bafb1a033
4	77437287-019c-46c5-81ea-cdb54d2a7d66	rack_a4	18	803dc602-6c99-4985-906b-8d4bafb1a033
5	dbb5f0bb-250c-4e1b-955d-db6d0b8301fc	rack_a5	22	803dc602-6c99-4985-906b-8d4bafb1a033
6	9289ad06-6dcd-4b7b-976c-c110a91bf5d7	rack_a6	26	803dc602-6c99-4985-906b-8d4bafb1a033
7	47f93c10-d202-4b38-8c15-7038c217d905	rack_a7	30	803dc602-6c99-4985-906b-8d4bafb1a033
8	bb4fb561-1998-42e1-9bdd-790a7b0cb751	rack_a8	34	803dc602-6c99-4985-906b-8d4bafb1a033
11	73ab2803-5078-4209-b334-8e8670c5630e	rack_a11	46	803dc602-6c99-4985-906b-8d4bafb1a033
12	03f1c318-9a7f-4122-854e-612b8ece1d7d	rack_a12	50	803dc602-6c99-4985-906b-8d4bafb1a033
13	ed32c415-4a1d-4235-a94d-8c8f19e4adf4	rack_a13	54	803dc602-6c99-4985-906b-8d4bafb1a033
14	df6d7d48-0a12-42a0-a689-132a751c8a77	rack_a14	58	803dc602-6c99-4985-906b-8d4bafb1a033
15	f2b4f786-bd41-488f-8b79-07217222a285	rack_a15	62	803dc602-6c99-4985-906b-8d4bafb1a033
16	29bae952-e458-422e-bdbf-dd57a0315b57	rack_a16	66	803dc602-6c99-4985-906b-8d4bafb1a033
17	474e07ea-c65c-4d85-8b48-ffeed99cefab	rack_a17	70	803dc602-6c99-4985-906b-8d4bafb1a033
18	3982c343-80b5-413d-825c-9e0f24c37558	rack_a18	74	803dc602-6c99-4985-906b-8d4bafb1a033
19	723537d5-7499-42c9-99b0-637265b4fcff	rack_a19	78	803dc602-6c99-4985-906b-8d4bafb1a033
20	1516a673-e5c8-4ee0-90a1-7b3b7f8e68cf	rack_a20	82	803dc602-6c99-4985-906b-8d4bafb1a033
21	5c31ef49-fef8-47b1-a006-6a2f728b5959	rack_a21	86	803dc602-6c99-4985-906b-8d4bafb1a033
22	05a28014-c1e9-4c5e-8762-5e8dc4505ade	rack_a22	90	803dc602-6c99-4985-906b-8d4bafb1a033
23	4f369f76-e6dc-4c0f-b412-046661db8a75	rack_a23	94	803dc602-6c99-4985-906b-8d4bafb1a033
30	991a1535-c776-44b6-b7e9-dc0d152f73c7	rack_a30	122	803dc602-6c99-4985-906b-8d4bafb1a033
31	225797d9-b623-4d3f-8973-6e05e589bf18	rack_a31	126	803dc602-6c99-4985-906b-8d4bafb1a033
32	27e26b8b-49cc-4c01-abe2-70667adfc37d	rack_a32	130	803dc602-6c99-4985-906b-8d4bafb1a033
33	f1e372dc-f83d-4f89-bc67-5eff737f0362	rack_a33	134	803dc602-6c99-4985-906b-8d4bafb1a033
34	1f9776ab-29d6-4b5c-94f9-b54a0a577736	rack_a34	138	803dc602-6c99-4985-906b-8d4bafb1a033
35	f1329b27-ef69-410e-bc28-cbcd43cf5a47	rack_a35	142	803dc602-6c99-4985-906b-8d4bafb1a033
36	7503ee98-8ab7-44f1-8afc-254f29e637aa	rack_a36	146	803dc602-6c99-4985-906b-8d4bafb1a033
37	a61b654f-a6ff-4353-8c3a-5f08765bf64e	rack_a37	150	803dc602-6c99-4985-906b-8d4bafb1a033
38	f4050299-3d13-414f-9fe3-ebf9d82b40ad	rack_a38	154	803dc602-6c99-4985-906b-8d4bafb1a033
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, email, password, role, active, "organizationId", "createdAt", "currentSessionId") FROM stdin;
71a78cfb-30fa-42a8-87dd-d24b04dbb1cd	klvnjntn@gmail.com	$2b$10$sd1FCo8WqCLIHeV6ecXkeuLmJ1bz3ugO7GsAmkf1FusF8duOnAUnS	ADMIN	t	803dc602-6c99-4985-906b-8d4bafb1a033	2026-08-08 17:02:31.235	e3f362d7-0f8f-4066-b15b-6e7202669a00
58089699-2b75-4065-ba95-cc95cd0b8efc	demoguy123@gmail.com	$2b$10$K8fTUftnHTWuGv6TyOAulu4h20CvQanmrBWNEqEnzp/s6ddw3zaAS	ADMIN	t	ad4a5bd9-60c0-4a72-bc19-01bba25db640	2026-08-20 17:02:41.614	d8f911c9-210a-4020-917b-58a8d37387c0
b7fb444e-34f2-4880-b11f-8dda61c02442	jexviana2@gmail.com	$2b$10$IxlFsxqahJZW3r3.IF7rMOP0ooAVlCyzplsMtxmQFJqcji/esvJmO	ADMIN	t	d6b797d6-2639-45af-885e-4acd0938ddaa	2026-08-11 09:33:38.564	8436bc30-9a5f-409e-98f5-f832e93dc4aa
\.


--
-- Data for Name: Vehicle; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Vehicle" (id, "customerId", "plateNumber", "vehicleModel", vin, odometer, "createdAt", "updatedAt") FROM stdin;
cmsxm6y1y0001ln011bjeyc9q	cmsqkfzds0001uo01byz05v8v	BP 1234 GF	AVANZA	\N	\N	2026-08-17 19:16:14.95	2026-08-17 19:16:14.95
cmt0ie4mx000jq601qrebkrc4	cmt0id8xg000hq601cjfbxwul	BP 1773 FG	Livina	\N	\N	2026-08-19 19:53:10.1	2026-08-19 19:53:10.1
cmt0ief5f000lq601yi2byxbd	cmsqkfzds0001uo01byz05v8v	BP 3214 FF	VELOZ	\N	\N	2026-08-19 19:53:23.764	2026-08-19 19:53:23.764
\.


--
-- Data for Name: VehicleReminder; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VehicleReminder" (id, "organizationId", "vehicleId", note, "dueDate", status, "completedAt", "createdAt", "updatedAt") FROM stdin;
cmt0ietjy000nq601w78mrbvo	803dc602-6c99-4985-906b-8d4bafb1a033	cmt0ie4mx000jq601qrebkrc4	Ganti bearing	2026-09-19 00:00:00	PENDING	\N	2026-08-19 19:53:42.43	2026-08-19 19:53:42.43
cmt0ifdhp000rq601r11nhrvb	803dc602-6c99-4985-906b-8d4bafb1a033	cmt0ief5f000lq601yi2byxbd	Ganti Bushing	2026-11-19 00:00:00	PENDING	\N	2026-08-19 19:54:08.269	2026-08-19 19:54:08.269
cmt0ibh6p0007q60132rswsji	803dc602-6c99-4985-906b-8d4bafb1a033	cmsxm6y1y0001ln011bjeyc9q	Oil Change	2026-09-19 00:00:00	COMPLETED	2026-08-19 20:47:44.499	2026-08-19 19:51:06.433	2026-08-19 20:47:44.5
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
3f7c5fa5-f04a-40d1-b6b0-e3846c5e2d49	e6a4ac68a2f06123b95bdca8ec436a1b9639a52ff73ef2d11287d750b9b1d139	2026-08-08 17:00:06.583191+00	20260618084809_add_session_to_event	\N	\N	2026-08-08 17:00:06.576666+00	1
b83689a1-9976-4068-8163-878142208f91	56c0f6eb4eb5e1b654dafd4e4a8bc4d9076fa95cc7dc9d932491904f95611229	2026-08-08 17:00:06.276938+00	20260611081251_init	\N	\N	2026-08-08 17:00:06.221464+00	1
72581fee-3484-4763-9148-2e2aa9f2b9b1	bdab567629f61112f573c91fdee5a223bf978d849d21313f03f1effa0b1289ec	2026-08-08 17:00:06.284869+00	20260611081522_init	\N	\N	2026-08-08 17:00:06.278685+00	1
dfa99ecd-71e8-441b-a74c-ceec086aaac6	9102d3a5600d5e0a2e30fc6bf29b7d17bcc98d5884d74257a3d82aa78a9e6695	2026-08-08 17:00:06.769535+00	20260625044335_add_user_events_relation	\N	\N	2026-08-08 17:00:06.761649+00	1
9bbaa30a-925b-4377-ad98-f9d8ddb1fb75	b5e4d4ab9ce60642dc10b0dd1008991ebe05bcba3c3fb45e0cda236ab7e3ae96	2026-08-08 17:00:06.297978+00	20260611090720_init_clean	\N	\N	2026-08-08 17:00:06.286509+00	1
2e6588b7-b797-4e32-9aac-4dd2d9a173ca	3e91ad31a016a84f5efb6d00d7c3a0b1edb7c8ea4bbf9b65c3519317af5e5484	2026-08-08 17:00:06.593559+00	20260618090613_add	\N	\N	2026-08-08 17:00:06.585117+00	1
5f571eb7-1580-42cf-9ed6-fcfd7f686148	07971cde6ed92ff4e7a80d8bf1616e3700abc5c2882f4dc3c8c2654ed9b34607	2026-08-08 17:00:06.327614+00	20260612043320_add_product_box	\N	\N	2026-08-08 17:00:06.299926+00	1
081af0b4-e8f8-48b6-bba5-6e4528ac7222	822e9cfd817402273464c88d4005719a13ae503ffd5d4e0b28a3ae27e9a9c1cc	2026-08-08 17:00:06.349058+00	20260612045424_add_item_event	\N	\N	2026-08-08 17:00:06.330593+00	1
2586b355-2a4b-445d-8c18-9cd9674f4234	09f6bacb908ef76624526954eb0c45f88a28f12cbc4f4a6bccff7844ce6787c7	2026-08-08 17:00:06.367521+00	20260613032227_add_categories	\N	\N	2026-08-08 17:00:06.350999+00	1
c5af2091-3bc0-4388-9d53-bdc85ce11c52	64b57e0a02bd1bfecca99892971ba438188a7914cecc8e04095035fcb59b1b10	2026-08-08 17:00:06.602648+00	20260618092637_add	\N	\N	2026-08-08 17:00:06.595437+00	1
f101a99a-e822-4659-85eb-894d76d4d78d	ed155205bbcd74e9810ff3adeaf867ca19be405100b2989e7136caaf422c109d	2026-08-08 17:00:06.376447+00	20260613081336_add_product_active	\N	\N	2026-08-08 17:00:06.369462+00	1
92192cdc-ac2f-4a11-acdb-07aa5b9978ac	42b8b09b96845f0c7c3aa791e1e879ccf413d6e1806cf02edf6f74c299025878	2026-08-08 17:00:06.438194+00	20260613104423_addstuff	\N	\N	2026-08-08 17:00:06.378359+00	1
0847e0be-0f93-4ab1-8281-16e244eb4326	01a2bd923913d0f1ab54fd54c181f7d1f2be94043783dba35c92e129008b94c5	2026-08-08 17:00:06.935474+00	20260803035756_session_type_stage_split	\N	\N	2026-08-08 17:00:06.92607+00	1
97787a4c-a70e-42af-aa99-e7fbdb1fe990	ba48fb8a81141d2ee8f6de95ac508809e737c2a4d591aaf5100a79d6904cb87c	2026-08-08 17:00:06.44679+00	20260615034158_add_prdocut	\N	\N	2026-08-08 17:00:06.440657+00	1
b78fcd6f-2d33-4d3c-83f9-ecfea3f5d26a	a55123c7c3194cf21a7736a606efa55a124dcb20eacf3d55c99acd2428f6a80d	2026-08-08 17:00:06.61033+00	20260618093824_add	\N	\N	2026-08-08 17:00:06.60436+00	1
36c20502-fc48-4cb3-92e3-b4f1febc5eee	7851977c870bc7d420673125e34bc9910eba1b112385f243bcafd003c9cfeb4a	2026-08-08 17:00:06.457648+00	20260615084310_add	\N	\N	2026-08-08 17:00:06.448459+00	1
e3748d5d-a119-4e22-b81d-46e685e68103	16c1f1904f7eeb554e019852930329f04dd095ed30709bceb0f4c41f9f26b301	2026-08-08 17:00:06.525216+00	20260615091043_add	\N	\N	2026-08-08 17:00:06.459668+00	1
365d5315-c4ac-4cc0-ace4-6647c0b31887	0ab6572c38c697fedad7bcd73d5db79425cfa5bcfda5edad8046f9dc42236601	2026-08-08 17:00:06.782285+00	20260702085019_add_product_barcode	\N	\N	2026-08-08 17:00:06.77182+00	1
1556126f-48cc-4ad5-9839-4d3591a113a1	336e0fe30af3b782333562562af7262a635029fb1876861df1bebee400cac335	2026-08-08 17:00:06.536258+00	20260617091337_add_adjustment_event	\N	\N	2026-08-08 17:00:06.528125+00	1
02ed96cc-95e7-46f5-9cd8-cc717f88f8c2	9e4b0f7ec3118abd1c5eeb4dbd37e47679dad6a8651357c64b86df443c6af289	2026-08-08 17:00:06.65839+00	20260619014824_add	\N	\N	2026-08-08 17:00:06.612116+00	1
dc923d73-fab2-43e3-add4-4982eaad7ea9	df0ca30f2e60b4ed887ecc2e7ab63e26c26113d6a6d9c7adce982cc154e0e255	2026-08-08 17:00:06.574673+00	20260618064228_add_sessions	\N	\N	2026-08-08 17:00:06.538591+00	1
60bdafee-fc4f-48b5-8777-c8ef7a45dd50	5051c3a110b12bd18203465f4d90b2f3a2ccb081343b8e8590edf007f957e2bf	2026-08-08 17:00:06.894879+00	20260802170505_add_session_expected_and_reopen	\N	\N	2026-08-08 17:00:06.877663+00	1
b33722a6-8675-440e-83b2-5da64a522263	b17b26f00c139f1f1f40ce59b0e3babc095a7132fb71e012777ec52c17165dae	2026-08-08 17:00:06.685987+00	20260619091559_remove_invoice	\N	\N	2026-08-08 17:00:06.660759+00	1
1dbbdd43-9ba5-4d5f-84ef-61ec1938875f	d8567123cc9e56cbb9f806b8bf2643cf05278c48fc4ebea39e05c278c678b333	2026-08-08 17:00:06.806503+00	20260727095720_add_license	\N	\N	2026-08-08 17:00:06.78447+00	1
82bd0abf-71aa-4041-bce3-3fa10f1653e8	73054f5e6c9d80380528c0f4678513ec15445c99512b92e464dcc2766e59ea28	2026-08-08 17:00:06.716345+00	20260620045533_add_auth	\N	\N	2026-08-08 17:00:06.688473+00	1
e5023937-e3db-42e4-b357-761f9e05568f	0c73965755d3ac40661024e086d4bd27cb75eedece7bd5bd6c4877b03c31e5df	2026-08-08 17:00:06.75147+00	20260623012929	\N	\N	2026-08-08 17:00:06.718041+00	1
3d653890-e079-410d-b318-d301c0fbb20f	8e4f38db6dd4403e3796f5b1a9e58dbea277ca325063d6a17a91c49d4e1c2ee1	2026-08-08 17:00:06.760133+00	20260623031520_add	\N	\N	2026-08-08 17:00:06.753205+00	1
a154b609-1beb-4cc8-8b46-5038d657c1b0	aafd63d5c15095ec25b50ee34ad8087cf08161bd2882944618e4ea83c1061af8	2026-08-08 17:00:06.814225+00	20260802084932_add_returns_event_type	\N	\N	2026-08-08 17:00:06.808325+00	1
3cd856ff-aaeb-4fbe-a37e-fb6132edae56	05a6910ec9be529883f335a83df3c4de10a16f42572513da5442e39959ef3ce4	2026-08-08 17:00:06.914502+00	20260802172729_add_session_expected_and_reopen	\N	\N	2026-08-08 17:00:06.896461+00	1
f5908f6a-192a-4429-b57a-4f4d802cd19b	7db69f0e35f23b443f95f0ccc9f7cd03b275271954288dbfc519fbc27ffbbad5	2026-08-08 17:00:06.851705+00	20260802145401_add_session_expected_and_reopen	\N	\N	2026-08-08 17:00:06.815871+00	1
1f7fa107-d6c0-4cce-84e4-3dbff9b5df89	f31e93981bdace9d51142a3bf62ae39588c23fe2ae533e6f1211c0ae7817cf4d	2026-08-08 17:00:06.875477+00	20260802164531_add_session_expected_and_reopen	\N	\N	2026-08-08 17:00:06.853354+00	1
2dcc1daf-29a9-4bdd-9136-08ae19848f3c	bc5b67e1b4383912853e7ad3f758e3ab0943c657a4e0a84d0a5edcbaf875e1e9	2026-08-08 17:00:06.952592+00	20260803213734_add_location_archived_at_and_import_variants	\N	\N	2026-08-08 17:00:06.946536+00	1
189305e3-d39b-4d10-8e5d-883bdd3dce39	e4ec6443317f315a01cdbc20a4085c1616bedea02843424e4e2c1e3979b2c8f4	2026-08-08 17:00:06.924163+00	20260802173412_add_session_expected_and_reopen	\N	\N	2026-08-08 17:00:06.916111+00	1
13b60942-653a-498f-98dd-9b161963d9c6	38a3417a0e0d9b9641f3223a6a2d8a0ea57b5d157b039838ad5867657a4f13dd	2026-08-08 17:00:06.944903+00	20260803211418_add_location_archived_at	\N	\N	2026-08-08 17:00:06.938013+00	1
5aef8173-603e-478a-be98-73612618d34d	47361649ca345612f120bce1fb6bae025c85ea3263b9574850debbd6d9972978	2026-08-08 17:00:07.003509+00	20260804113225_add_installation	\N	\N	2026-08-08 17:00:06.985733+00	1
865d02ef-8d3a-4b36-9063-ddc8797a4ca3	6413112cb436f47d002d8b034781b5028cf09cdadc386cd01487cf9338537204	2026-08-08 17:00:06.984154+00	20260803214035_remove_event_import_type	\N	\N	2026-08-08 17:00:06.954796+00	1
c1b6638e-c1f7-478a-ae19-ab5f19e7f76d	96da978e161e484c4a19bd1a97db240e9cd90ede58776e0bb4b2ddf8151f67eb	2026-08-08 17:00:07.011306+00	20260804191843_add_fulfillment_mode	\N	\N	2026-08-08 17:00:07.005025+00	1
b75c172a-3ca8-4cd8-b9f8-da28922e2e04	7c4aca65d75bcf0ba87c9d16dbc191aa562028130d1e924ea0210c319acdb788	2026-08-08 17:00:07.018596+00	20260805153206_add_current_session	\N	\N	2026-08-08 17:00:07.01348+00	1
462b5230-37e2-4356-8cc6-443f63b1fc12	2b3703dba7d3165f15c34a08b0011ce2327aca52828c20548b9532667ce6b8c1	2026-08-08 17:33:54.268387+00	20260808173014_add_integration_layer	\N	\N	2026-08-08 17:33:54.071218+00	1
e2ced513-ef99-4084-88a9-53aaba51f30e	bafbac88129ebf61727b8f6a69c0c004e8aeeedcf8405679db09f34fa41e6dcb	2026-08-09 19:00:09.316231+00	20260809184027_add_license_fields	\N	\N	2026-08-09 19:00:09.214751+00	1
c90d748a-7a90-464c-9caf-5a1d3f54be7e	5e6a3405d15314d800b37ef726ef97cecd0bfc52f8b24bb1b9b30534c9b091f0	2026-08-09 19:00:09.325913+00	20260809185049_add_license_fields	\N	\N	2026-08-09 19:00:09.318156+00	1
4ca087e8-ea93-4e50-b9e0-cfcfa0b48f84	bcc4da500f1de8dd03d572233471ae10082f77375f8c5c946b3f3f0c1336ac64	2026-08-11 09:11:17.330229+00	20260811090033_add_license_fields	\N	\N	2026-08-11 09:11:17.306648+00	1
b8483fc9-c9d1-4f1f-b677-2352dcff51e4	6e3f2ad7f937fe944f53f3c15c1b9b6a44fe0c5ead2cfcbcc4a4cea6f2e765e0	2026-08-11 22:42:21.24866+00	20260811223959_add_pos_pricing_enabled	\N	\N	2026-08-11 22:42:21.19846+00	1
97c099a5-f11a-485d-a6f7-8fa7d7fa4099	97f01a20ec7a87631ae684aafcca202eda504f88b33fb14e27cbb9fd0993d55a	2026-08-12 19:52:14.64735+00	20260812194843_add_customers	\N	\N	2026-08-12 19:52:14.578883+00	1
aa504bd7-2a0c-47be-80b8-3ea1852a62ff	5df6aca377e65780211351c642a359e4d1b2356fa5d51cb5aefdb2a397fd639b	2026-08-12 22:30:14.890937+00	20260812212539_rawr	\N	\N	2026-08-12 22:30:14.819591+00	1
d0bad558-9396-4070-aa5f-e59114149632	c994040226a314d29d687b695992e504828a21d0917d89a051e298c0e0a9a4df	2026-08-12 23:47:50.654328+00	20260812230441_rawr	\N	\N	2026-08-12 23:47:50.624768+00	1
4b03b1a1-8491-47f0-b767-941e19271a96	8f66f4e6f26b04b53abaf5b30bc3cd3417edb847a1d3e4d807fdb29121bf73b7	2026-08-12 23:47:50.825814+00	20260812232357_add_invoice_tax	\N	\N	2026-08-12 23:47:50.656052+00	1
afc9c742-04be-4b65-8afc-824931d37afe	c155555a747d971662e319f3ead5f1cf0cc53ce5577d5913ec0315ccc66c1482	2026-08-12 23:47:50.860453+00	20260812232511_add_invoice_tax	\N	\N	2026-08-12 23:47:50.832601+00	1
63f9e021-db82-4a47-a585-0db4d4e20dae	aec7888667b132aed99d157549778212b397ac7f8dec80cc357fee614c40632c	2026-08-13 08:28:52.264042+00	20260813081017_rawr	\N	\N	2026-08-13 08:28:52.210267+00	1
c6d0ec9a-2c38-4f4a-bb29-17704aad74ed	151fbe9f70ea33034348565174ce49e7022e4ff704efedff506081adf6105ac6	2026-08-13 10:16:46.361961+00	20260813091941_rawr	\N	\N	2026-08-13 10:16:46.192639+00	1
116b6a38-0341-4a26-9c01-6568ccb02f7d	e177a759ceb50abdfa3ce8b4a83e9c0aef86f4c676a2f68592908c695ae8a54b	\N	20260813100721_add_invoice_item_location	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260813100721_add_invoice_item_location\n\nDatabase error code: 23502\n\nDatabase error:\nERROR: column "locationId" of relation "InvoiceItem" contains null values\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E23502), message: "column \\"locationId\\" of relation \\"InvoiceItem\\" contains null values", detail: None, hint: None, position: None, where_: None, schema: Some("public"), table: Some("InvoiceItem"), column: Some("locationId"), datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(6111), routine: Some("ATRewriteTable") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260813100721_add_invoice_item_location"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260813100721_add_invoice_item_location"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-08-13 11:07:24.574291+00	2026-08-13 10:16:46.364759+00	0
a8c54474-32e7-48ac-96c2-454e77bcf8e4	9d72a6a8700c5611fdd6db9cd64bd47b6cecb0dab1ea80758766e0c4f6df9eff	2026-08-13 11:07:36.288823+00	20260813100721_add_invoice_item_location	\N	\N	2026-08-13 11:07:35.969221+00	1
a4a0bde5-a1ec-4c60-95d2-0f5366ea4a4e	ef2fc230c38b1ff5fc88169243c8d06cebaec3629229f64e959c93a6ec641d45	2026-08-13 11:41:57.887122+00	20260813113757_add_invoice_item_location	\N	\N	2026-08-13 11:41:57.818989+00	1
3d951eca-564c-49ae-b7ea-0dbe11bb661e	b682bdeeb46991699b4d04b8d6531e0b157658cf0a071cb4b0ae8957f327afae	2026-08-17 13:07:34.686151+00	20260817123443_customer_workshop_rms_fields	\N	\N	2026-08-17 13:07:34.671225+00	1
3c3a6639-2aa0-4a3c-948a-a437bac20d40	e84960e5d60c25a518c3bd04fb39d31baaa87ad12850a29ffacf7e005300db21	2026-08-17 19:09:59.59281+00	20260817133739_customer_workshop_rms_fields	\N	\N	2026-08-17 19:09:59.526852+00	1
3c52affb-738d-4db3-bcac-6858cc9fc975	2694e5027ca340ab5d349a78e9c08ef41e1f5182a700c6cd8fdfa8710aa28cbb	2026-08-18 07:47:36.912943+00	20260817194016_customer_workshop_rms_fields	\N	\N	2026-08-18 07:47:36.841448+00	1
3543bf4d-193c-4684-b060-7e1c6bbc6f2b	fc050032290c6356a35c0f9371e7a3ebd8d1e7b5772558d9dff72c29987e2b9b	2026-08-18 08:40:56.422099+00	20260818075503_customer_workshop_rms_fields	\N	\N	2026-08-18 08:40:56.346571+00	1
7af4a219-8bb6-49d8-9d9f-6d08c6d1b991	13af2237fa15153a9b8fa1c288c18811cdb1b74ed99421d40edb582b58797211	2026-08-19 20:40:16.381857+00	20260819202145_customer_workshop_rms_fields	\N	\N	2026-08-19 20:40:16.354097+00	1
\.


--
-- Name: Event_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Event_id_seq"', 203, true);


--
-- Name: ExternalOrderItem_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ExternalOrderItem_id_seq"', 1, false);


--
-- Name: InvoiceItem_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvoiceItem_id_seq"', 281, true);


--
-- Name: SessionItem_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."SessionItem_id_seq"', 1, false);


--
-- Name: SessionReopenEvent_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."SessionReopenEvent_id_seq"', 1, false);


--
-- Name: Stock_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Stock_id_seq"', 196, true);


--
-- Name: Brand Brand_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Brand"
    ADD CONSTRAINT "Brand_pkey" PRIMARY KEY (id);


--
-- Name: Category Category_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);


--
-- Name: Customer Customer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Customer"
    ADD CONSTRAINT "Customer_pkey" PRIMARY KEY (id);


--
-- Name: Event Event_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_pkey" PRIMARY KEY (id);


--
-- Name: ExternalOrderItem ExternalOrderItem_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrderItem"
    ADD CONSTRAINT "ExternalOrderItem_pkey" PRIMARY KEY (id);


--
-- Name: ExternalOrder ExternalOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrder"
    ADD CONSTRAINT "ExternalOrder_pkey" PRIMARY KEY (id);


--
-- Name: ExternalProductMapping ExternalProductMapping_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalProductMapping"
    ADD CONSTRAINT "ExternalProductMapping_pkey" PRIMARY KEY (id);


--
-- Name: Installation Installation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Installation"
    ADD CONSTRAINT "Installation_pkey" PRIMARY KEY (id);


--
-- Name: IntegrationConnection IntegrationConnection_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntegrationConnection"
    ADD CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY (id);


--
-- Name: InvoiceItemTax InvoiceItemTax_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItemTax"
    ADD CONSTRAINT "InvoiceItemTax_pkey" PRIMARY KEY (id);


--
-- Name: InvoiceItem InvoiceItem_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY (id);


--
-- Name: InvoiceTax InvoiceTax_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceTax"
    ADD CONSTRAINT "InvoiceTax_pkey" PRIMARY KEY (id);


--
-- Name: Invoice Invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY (id);


--
-- Name: License License_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."License"
    ADD CONSTRAINT "License_pkey" PRIMARY KEY (id);


--
-- Name: Location Location_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY (id);


--
-- Name: OrganizationModule OrganizationModule_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."OrganizationModule"
    ADD CONSTRAINT "OrganizationModule_pkey" PRIMARY KEY (id);


--
-- Name: OrganizationTaxRate OrganizationTaxRate_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."OrganizationTaxRate"
    ADD CONSTRAINT "OrganizationTaxRate_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: SessionItem SessionItem_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionItem"
    ADD CONSTRAINT "SessionItem_pkey" PRIMARY KEY (id);


--
-- Name: SessionNote SessionNote_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionNote"
    ADD CONSTRAINT "SessionNote_pkey" PRIMARY KEY (id);


--
-- Name: SessionReopenEvent SessionReopenEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionReopenEvent"
    ADD CONSTRAINT "SessionReopenEvent_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: Stock Stock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Stock"
    ADD CONSTRAINT "Stock_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: VehicleReminder VehicleReminder_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VehicleReminder"
    ADD CONSTRAINT "VehicleReminder_pkey" PRIMARY KEY (id);


--
-- Name: Vehicle Vehicle_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Vehicle"
    ADD CONSTRAINT "Vehicle_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Brand_organizationId_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Brand_organizationId_name_key" ON public."Brand" USING btree ("organizationId", name);


--
-- Name: Category_organizationId_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Category_organizationId_name_key" ON public."Category" USING btree ("organizationId", name);


--
-- Name: Customer_orgId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Customer_orgId_idx" ON public."Customer" USING btree ("orgId");


--
-- Name: Customer_orgId_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Customer_orgId_name_idx" ON public."Customer" USING btree ("orgId", name);


--
-- Name: ExternalOrder_connectionId_externalRef_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ExternalOrder_connectionId_externalRef_key" ON public."ExternalOrder" USING btree ("connectionId", "externalRef");


--
-- Name: ExternalOrder_sessionId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ExternalOrder_sessionId_key" ON public."ExternalOrder" USING btree ("sessionId");


--
-- Name: ExternalProductMapping_connectionId_externalSku_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ExternalProductMapping_connectionId_externalSku_key" ON public."ExternalProductMapping" USING btree ("connectionId", "externalSku");


--
-- Name: Installation_fingerprint_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Installation_fingerprint_key" ON public."Installation" USING btree (fingerprint);


--
-- Name: InvoiceItemTax_invoiceItemId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvoiceItemTax_invoiceItemId_idx" ON public."InvoiceItemTax" USING btree ("invoiceItemId");


--
-- Name: InvoiceTax_invoiceId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvoiceTax_invoiceId_idx" ON public."InvoiceTax" USING btree ("invoiceId");


--
-- Name: Invoice_organizationId_invoiceNumber_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON public."Invoice" USING btree ("organizationId", "invoiceNumber");


--
-- Name: License_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "License_key_key" ON public."License" USING btree (key);


--
-- Name: Location_organizationId_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Location_organizationId_name_key" ON public."Location" USING btree ("organizationId", name);


--
-- Name: OrganizationModule_organizationId_module_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "OrganizationModule_organizationId_module_key" ON public."OrganizationModule" USING btree ("organizationId", module);


--
-- Name: OrganizationTaxRate_organizationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "OrganizationTaxRate_organizationId_idx" ON public."OrganizationTaxRate" USING btree ("organizationId");


--
-- Name: Payment_invoiceId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Payment_invoiceId_idx" ON public."Payment" USING btree ("invoiceId");


--
-- Name: Product_organizationId_barcode_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON public."Product" USING btree ("organizationId", barcode);


--
-- Name: Product_sku_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Product_sku_key" ON public."Product" USING btree (sku);


--
-- Name: Session_invoiceId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Session_invoiceId_key" ON public."Session" USING btree ("invoiceId");


--
-- Name: Stock_productId_locationId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Stock_productId_locationId_key" ON public."Stock" USING btree ("productId", "locationId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: VehicleReminder_organizationId_status_dueDate_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VehicleReminder_organizationId_status_dueDate_idx" ON public."VehicleReminder" USING btree ("organizationId", status, "dueDate");


--
-- Name: VehicleReminder_vehicleId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VehicleReminder_vehicleId_idx" ON public."VehicleReminder" USING btree ("vehicleId");


--
-- Name: Vehicle_customerId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Vehicle_customerId_idx" ON public."Vehicle" USING btree ("customerId");


--
-- Name: Brand Brand_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Brand"
    ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Category Category_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Customer Customer_orgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Customer"
    ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Event Event_fromLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Event Event_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Event Event_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Event Event_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Event Event_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."Session"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Event Event_sessionItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES public."SessionItem"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Event Event_toLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Event Event_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Event"
    ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExternalOrderItem ExternalOrderItem_externalOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrderItem"
    ADD CONSTRAINT "ExternalOrderItem_externalOrderId_fkey" FOREIGN KEY ("externalOrderId") REFERENCES public."ExternalOrder"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExternalOrderItem ExternalOrderItem_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrderItem"
    ADD CONSTRAINT "ExternalOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExternalOrder ExternalOrder_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrder"
    ADD CONSTRAINT "ExternalOrder_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."IntegrationConnection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExternalOrder ExternalOrder_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrder"
    ADD CONSTRAINT "ExternalOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExternalOrder ExternalOrder_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalOrder"
    ADD CONSTRAINT "ExternalOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."Session"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExternalProductMapping ExternalProductMapping_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalProductMapping"
    ADD CONSTRAINT "ExternalProductMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."IntegrationConnection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExternalProductMapping ExternalProductMapping_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ExternalProductMapping"
    ADD CONSTRAINT "ExternalProductMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: IntegrationConnection IntegrationConnection_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntegrationConnection"
    ADD CONSTRAINT "IntegrationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvoiceItemTax InvoiceItemTax_invoiceItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItemTax"
    ADD CONSTRAINT "InvoiceItemTax_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES public."InvoiceItem"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvoiceItemTax InvoiceItemTax_taxRateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItemTax"
    ADD CONSTRAINT "InvoiceItemTax_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES public."OrganizationTaxRate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvoiceItem InvoiceItem_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvoiceItem InvoiceItem_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvoiceItem InvoiceItem_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvoiceTax InvoiceTax_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceTax"
    ADD CONSTRAINT "InvoiceTax_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvoiceTax InvoiceTax_taxRateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvoiceTax"
    ADD CONSTRAINT "InvoiceTax_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES public."OrganizationTaxRate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_customerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public."Customer"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Invoice Invoice_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_vehicleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Location Location_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Location"
    ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrganizationModule OrganizationModule_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."OrganizationModule"
    ADD CONSTRAINT "OrganizationModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrganizationTaxRate OrganizationTaxRate_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."OrganizationTaxRate"
    ADD CONSTRAINT "OrganizationTaxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Payment Payment_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Payment Payment_recordedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_brandId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES public."Brand"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."Category"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Product Product_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SessionItem SessionItem_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionItem"
    ADD CONSTRAINT "SessionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SessionItem SessionItem_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionItem"
    ADD CONSTRAINT "SessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."Session"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SessionNote SessionNote_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionNote"
    ADD CONSTRAINT "SessionNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."Session"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SessionNote SessionNote_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionNote"
    ADD CONSTRAINT "SessionNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SessionReopenEvent SessionReopenEvent_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionReopenEvent"
    ADD CONSTRAINT "SessionReopenEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public."Session"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SessionReopenEvent SessionReopenEvent_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SessionReopenEvent"
    ADD CONSTRAINT "SessionReopenEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Session Session_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Session Session_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Stock Stock_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Stock"
    ADD CONSTRAINT "Stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Stock Stock_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Stock"
    ADD CONSTRAINT "Stock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Stock Stock_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Stock"
    ADD CONSTRAINT "Stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: User User_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VehicleReminder VehicleReminder_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VehicleReminder"
    ADD CONSTRAINT "VehicleReminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VehicleReminder VehicleReminder_vehicleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VehicleReminder"
    ADD CONSTRAINT "VehicleReminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Vehicle Vehicle_customerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Vehicle"
    ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public."Customer"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict tAFBVENgXlUU3cCe0eIQd1K9hiXaLSF9qIp1ymCbmhI6qCaWBO4SWAxSdZjAPki

